import { describe } from "bun:test";
import { registerClientResolver } from "./parity/client-resolver";
import { registerClientAuth } from "./parity/client-auth";
import { registerClientFlow } from "./parity/client-flow";
import { registerClientData } from "./parity/client-data";

describe("parité TS <-> Kotlin du client + données (#201/#202)", () => {
  registerClientResolver();
  registerClientAuth();
  registerClientFlow();
  registerClientData();
});
