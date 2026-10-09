

type Job = {
    id: number,
    name: string,
    task: () => Promise<void>
}


export class JobQueue {
    private workers: number
    private activeWorkers: number =0

    private queue: Job[] = []

    constructor(worker: number) {
        this.workers = worker
    }




     addJob(job: Job) {

        this.queue.push(job)
        console.log(`Job ${job.id} enqued`)
        this.processNext()
    }

    private processNext() {
        while (
            this.activeWorkers < this.workers &&
            this.queue.length > 0
        ) {

            const job = this.queue.shift()
            this.activeWorkers++
            this.runJob(job)

        }
    }


    private async runJob(job: Job) {
        try {
            const task = job.task
            await task()
      
            console.log('------------------------------------------------')
        } catch {
            console.log('Error while executing tasks')
        } finally {
            this.activeWorkers--
            this.processNext()
        }
    }
}