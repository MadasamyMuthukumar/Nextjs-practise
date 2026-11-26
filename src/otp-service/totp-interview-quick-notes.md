# TOTP — Backend Interview Quick Notes

## 1. What is TOTP?

**TOTP (Time-Based One-Time Password)** generates a short code (commonly 6 digits) from:

- A **shared secret** known to the user's authenticator app and backend.
- The **current time**, divided into fixed intervals (commonly 30 seconds).

Both sides independently calculate the same code. No SMS/email is sent for each login.

**Problem it solves:** Adds a second factor to password login without depending on SMS delivery. Commonly used for MFA on user and administrator accounts, VPNs, and sensitive actions.

> TOTP improves security, but it is not fully phishing-resistant. Passkeys/WebAuthn provide stronger phishing protection.

## 2. TOTP vs SMS OTP vs HOTP

| Method | How code is generated | Main characteristic |
|---|---|---|
| TOTP | Shared secret + current time | Changes every time interval; no delivery provider needed |
| SMS OTP | Server generates a code | Delivered through SMS; depends on provider/network and phone-number security |
| HOTP | Shared secret + counter | Changes when the counter advances, not automatically with time |

TOTP is based on HOTP, but replaces its event counter with a time-based counter.

## 3. How TOTP works

### Enrollment (one-time setup)

1. User signs in and chooses **Enable authenticator app**.
2. Backend generates a cryptographically random secret for that authenticator.
3. Backend stores the secret **encrypted** and creates an `otpauth://` provisioning URI.
4. Frontend displays the URI as a QR code.
5. User scans it with Google Authenticator, Microsoft Authenticator, or another compatible app.
6. User enters the app's current code.
7. Backend verifies the code and changes the authenticator status from `PENDING` to `ENABLED`.

The QR code contains the secret. Treat it like a password: show it only during a protected enrollment flow and never log it.

### Login

1. User submits email/password.
2. Backend validates the password.
3. If TOTP is enabled, backend creates a short-lived **MFA-pending challenge** (not a fully authenticated access token).
4. User enters the authenticator code.
5. Backend decrypts the stored secret and calculates the expected TOTP for the allowed time steps.
6. If valid and not previously used, backend atomically consumes that time step and issues the authenticated session/token.

## 4. Core algorithm — remember this

Typical configuration: **SHA-1, 6 digits, 30-second period** (these are configurable parameters).

Time counter:

```text
T = floor((UnixTime - T0) / period)
```

Usually `T0 = 0` and `period = 30 seconds`.

Code generation:

```text
counterBytes = 8-byte big-endian encoding of T
hmac         = HMAC(secret, counterBytes)
number       = DynamicTruncate(hmac)   // positive 31-bit integer
OTP          = number mod 1,000,000
```

Pad the result to six characters, including leading zeros (example: `004281`). Keep OTPs as **strings**, not integers.

**Key idea:** the authenticator and backend have the same secret and time, so they independently calculate the same result. The server does not need to generate or store a new OTP every 30 seconds; it calculates expected values when verifying a submitted code.

## 5. Database schema (PostgreSQL example)

The backend stores the long-lived secret, **not a row for every generated OTP**.

```sql
CREATE TABLE totp_authenticators (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Authenticator',
    secret_ciphertext BYTEA NOT NULL,
    encryption_key_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ENABLED', 'DISABLED')),
    confirmed_at TIMESTAMPTZ,
    enrollment_expires_at TIMESTAMPTZ,
    last_accepted_step BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_totp_user_status
    ON totp_authenticators(user_id, status);

CREATE TABLE mfa_recovery_codes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash BYTEA NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, code_hash)
);
```

Important fields:

- `secret_ciphertext`: encrypted secret; the backend must decrypt it to verify codes.
- `status`: only `ENABLED` authenticators can be used for login.
- `enrollment_expires_at`: expire abandoned pending enrollment.
- `last_accepted_step`: prevents reuse of an already accepted time step.
- `encryption_key_version`: supports encryption-key rotation.
- `code_hash`: recovery codes are stored as hashes because the original code is not needed for verification.

Multiple devices can be supported by storing multiple authenticator rows per user.

## 6. Verification and clock drift

A phone's clock may differ slightly from the server's clock. A common policy checks:

```text
current time step - 1
current time step
current time step + 1
```

This is a small tolerance window (±30 seconds for a 30-second period). Keep it narrow and synchronize backend clocks using reliable time services.

The verifier should return the **matched time-step counter**, not just `true/false`, because that counter must be consumed to stop replay.

## 7. Replay prevention — important interview point

A valid TOTP can remain valid for part of its 30-second interval. Without extra protection, the same code could be submitted more than once.

After matching a code to step `matched_step`, consume it with one atomic conditional update:

```sql
UPDATE totp_authenticators
SET last_accepted_step = $1,
    updated_at = NOW()
WHERE id = $2
  AND user_id = $3
  AND status = 'ENABLED'
  AND (last_accepted_step IS NULL OR last_accepted_step < $1)
RETURNING id;
```

- One row returned: this request consumed the step; continue login.
- No row returned: the step was already used, or the authenticator is no longer enabled.

**Why atomic?** Two requests may verify the same code at nearly the same time. The conditional database update ensures only one can consume that time step. Issue the final session/token only after this update succeeds.

## 8. Production edge cases and protections

| Risk / edge case | What to do |
|---|---|
| Many wrong guesses | Rate-limit by account and IP; monitor attempts and apply temporary restrictions |
| Reusing a valid code | Track and atomically consume `last_accepted_step` |
| Clock difference | Small time window; keep server clocks synchronized |
| Database leak | Encrypt TOTP secrets; restrict access; never log plaintext secrets or QR URIs |
| Lost phone | Provide single-use recovery codes and a secure account-recovery process |
| Abandoned enrollment | Keep it `PENDING` and expire it |
| Concurrent verification requests | Use an atomic conditional SQL update, not only application checks |
| Code starts with zero | Treat it as a string and preserve all digits |
| QR/secret theft | Require recent authentication, HTTPS, short enrollment expiry, and protected display |
| MFA disable/reset | Require fresh authentication and notify the user about the security change |
| DB/KMS unavailable | Fail closed for MFA-protected login; do not silently bypass MFA |

**Secret storage vs recovery-code storage:** TOTP secret = encrypted (must be recoverable by backend); recovery code = hashed (only comparison is needed).

## 9. Simple scalable architecture

```text
Client
  |
  v
API Gateway / Load Balancer
  |
  v
Authentication Service
  |                     |
  v                     v
Redis                PostgreSQL
(rate limits,         (encrypted TOTP secret,
 short-lived          status, accepted step,
 MFA challenge)       recovery-code hashes)
  |
  v
KMS / Secrets Manager
(protects encryption keys used for TOTP secrets)
```

- Authentication service instances can be stateless and horizontally scaled.
- Redis can hold distributed attempt limits and short-lived MFA challenges.
- PostgreSQL stores authenticator state and provides the atomic replay-prevention update.
- KMS/secrets manager protects encryption keys; do not hardcode keys in source code.
- **No Kafka, queue, or background worker is required just to generate TOTP codes.** HMAC verification is lightweight. Queues may be useful for separate audit or notification tasks.

## 10. Useful implementation endpoints

Example API design:

```text
POST /auth/mfa/totp/enroll       -> create pending secret + provisioning URI
POST /auth/mfa/totp/confirm      -> verify first code + enable authenticator
POST /auth/login                -> validate password; return MFA-pending challenge if needed
POST /auth/mfa/totp/verify      -> verify code, consume step, issue session
POST /auth/mfa/recovery/verify  -> consume one recovery code
DELETE /auth/mfa/totp/:id       -> disable authenticator after fresh authentication
```

Use a well-maintained TOTP library in production rather than maintaining custom cryptographic code. Test interoperability against RFC test vectors. Never return the secret again after enrollment is complete.

## 11. Interview answer — 30-second version

> “TOTP is a time-based second factor. During enrollment, the backend generates a random secret, stores it encrypted, and shows a QR code that the authenticator app scans. At login, both the app and backend independently calculate a six-digit code using the shared secret, current time-step, and HMAC. The backend checks a small clock-drift window, rate-limits attempts, and atomically records the matched time step to prevent replay. After successful verification, it issues the authenticated session. I also provide single-use recovery codes for lost devices.”

## 12. Quick checklist to remember

- [ ] Shared random secret per authenticator.
- [ ] QR enrollment + first-code confirmation.
- [ ] Encrypt TOTP secret; never store it in plaintext.
- [ ] Typical defaults: 6 digits, 30 seconds, HMAC-SHA1.
- [ ] Keep OTP as a string (leading zeros matter).
- [ ] Allow only a small clock-drift window.
- [ ] Rate-limit verification attempts.
- [ ] Atomically consume the matched time step to prevent replay.
- [ ] Use short-lived MFA-pending challenges before full login.
- [ ] Recovery codes are random, single-use, and stored hashed.
- [ ] Secure MFA enrollment, disable, and recovery flows.

## References

- [RFC 6238 — TOTP: Time-Based One-Time Password Algorithm](https://www.rfc-editor.org/rfc/rfc6238)
- [RFC 4226 — HOTP: An HMAC-Based One-Time Password Algorithm](https://www.rfc-editor.org/rfc/rfc4226)
- [OWASP Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
