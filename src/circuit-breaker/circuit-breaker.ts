import { BadRequestException } from "@nestjs/common"

type CircuitStat = 'OPEN' | 'CLOSED' | 'HALF_OPEN'

export class CircuitBreaker {
    private state: CircuitStat = 'CLOSED'
    private openedAt = 0
    private failedCount = 0
    private halfOpenInProgress = false

    constructor(
        private readonly requestThreshold: number = 3,
        private readonly requestTimeout = 5000
    ) { }


    async execute<T>(action: () => Promise<T>): Promise<T> {

        if (this.state == 'OPEN') {
            const elapsed = Date.now() - this.openedAt

            if (elapsed < this.requestTimeout) throw new BadRequestException()

            this.state = 'HALF_OPEN'
        }

        if (this.state == 'HALF_OPEN') {
            if (this.halfOpenInProgress) {
                console.log('probe job is processing')
                throw new BadRequestException()
            }

            this.halfOpenInProgress = true
        }

        try {
            const result = await action()

            this.failedCount = 0
            this.state = 'CLOSED'
            this.openedAt = 0
            return result
        } catch (error) {
            this.failedCount++

            if (this.state == 'HALF_OPEN') {
                this.openedAt = Date.now()
                this.state = 'OPEN'
            } else if (this.failedCount > this.requestThreshold) {
                this.state = 'OPEN'
                this.openedAt = Date.now()
            }

            throw error

        } finally {
            if (this.state === 'HALF_OPEN') this.halfOpenInProgress = false
        }

    }
}