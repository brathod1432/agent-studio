// Agent abstraction. An agent turns a user input into a response, encapsulating
// memory, prompting, and LLM orchestration.

export interface Agent {
  run(input: string): Promise<string>;
}

/** Called with each incremental text delta while a streaming agent responds. */
export type AgentDeltaHandler = (delta: string) => void;

export interface StreamingAgent extends Agent {
  runStream(input: string, onDelta: AgentDeltaHandler): Promise<string>;
}
