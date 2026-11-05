declare module 'pg' {
  export interface QueryResultRow {
    [column: string]: unknown
  }

  export interface QueryResult<R extends QueryResultRow = QueryResultRow> {
    rows: R[]
    rowCount: number | null
  }

  export interface ClientConfig {
    connectionString?: string
    connectionTimeoutMillis?: number
    query_timeout?: number
    application_name?: string
    options?: string
  }

  export class Client {
    constructor(config?: ClientConfig)
    connect(): Promise<void>
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>
    end(): Promise<void>
  }

  export interface PoolConfig {
    connectionString?: string
    max?: number
    idleTimeoutMillis?: number
    connectionTimeoutMillis?: number
  }

  export class PoolClient {
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>
    release(): void
  }

  export class Pool {
    constructor(config?: PoolConfig)
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>
    connect(): Promise<PoolClient>
    end(): Promise<void>
  }

  const pg: {
    Client: typeof Client
    Pool: typeof Pool
  }

  export default pg
}
