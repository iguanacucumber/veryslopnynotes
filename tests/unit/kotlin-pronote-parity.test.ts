import { describe } from "bun:test";
import { registerProtocolJson } from "./parity/protocol-json";
import { registerProtocolCrypto } from "./parity/protocol-crypto";
import { registerProtocolHttp } from "./parity/protocol-http";
import { registerProtocolWire } from "./parity/protocol-wire";

describe("parité TS <-> Kotlin du protocole (#200/#202)", () => {
  registerProtocolJson();
  registerProtocolCrypto();
  registerProtocolHttp();
  registerProtocolWire();
});
