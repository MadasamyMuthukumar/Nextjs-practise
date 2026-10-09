import { JobQueue } from "./jobqueue"



const createJob = (id) => {
    return {
        id,
        name: `job-${id}`,
        task: async () => {
            console.log(`Executing job ${id}`)
            await new Promise((resolve) => setTimeout(resolve, 2000))
            console.log(`Done Job ${id}`)
        }
    }
}

const queue = new JobQueue(3)

queue.addJob(createJob(1))
queue.addJob(createJob(2))
queue.addJob(createJob(3))
queue.addJob(createJob(4))
queue.addJob(createJob(5))