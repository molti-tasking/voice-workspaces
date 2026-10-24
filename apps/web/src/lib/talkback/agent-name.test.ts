import { describe, expect, it } from "vitest";
import { agentName } from "./agent-name";

describe("what the screen calls the agent", () => {
  it("keeps a name as it is, and capitalises a description where a sentence starts", () => {
    expect(agentName("Souffleur")).toEqual({
      name: "Souffleur",
      Name: "Souffleur",
      possessive: "Souffleur's",
      Possessive: "Souffleur's",
    });
    expect(agentName("the assistant")).toEqual({
      name: "the assistant",
      Name: "The assistant",
      possessive: "the assistant's",
      Possessive: "The assistant's",
    });
  });
});
