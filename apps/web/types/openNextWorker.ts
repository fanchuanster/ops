interface OpenNextWorker {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>
}

declare const worker: OpenNextWorker
export default worker

export declare const DOQueueHandler: unknown
export declare const DOShardedTagCache: unknown
export declare const BucketCachePurge: unknown
