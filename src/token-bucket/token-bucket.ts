

interface Bucket {
    tokens: number
    lastRefillTime: number
}


export class TokenBucketLimiter {

    private bucket = new Map<string, Bucket>()
    constructor(
        private readonly capacity: number,
        private readonly refillRatePerSecond: number
    ) { }


    allowRequest(userId): boolean {
        let bucket = this.bucket.get(userId)
        const now = Date.now()

        if (!bucket) {
            bucket = {
                tokens: this.capacity,
                lastRefillTime: now
            }
            this.bucket.set(userId, bucket)
        }

        const elapsedTime = (now - bucket.lastRefillTime) / 1000

        const calculatedTokens = Math.min(this.capacity, bucket.tokens + (elapsedTime * this.refillRatePerSecond))

        bucket.tokens = calculatedTokens

        bucket.lastRefillTime = now

        if (bucket.tokens < 1) return false

        bucket.tokens -= 1

        return true
    }
}