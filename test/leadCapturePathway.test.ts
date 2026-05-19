import { describe, expect, test } from "bun:test";
import {
  createVoiceLeadCapturePathway,
  DEFAULT_VOICE_LEAD_CAPTURE_REQUIRED_FIELDS,
} from "../src/voice";
import { validateVoicePathway } from "@absolutejs/voice";

describe("createVoiceLeadCapturePathway", () => {
  test("default pathway is valid per validateVoicePathway", () => {
    const pathway = createVoiceLeadCapturePathway();
    const report = validateVoicePathway(pathway);
    expect(report.valid).toBe(true);
    expect(
      report.issues.filter((i) => i.severity === "error"),
    ).toHaveLength(0);
  });

  test("default slots include required fields", () => {
    const pathway = createVoiceLeadCapturePathway();
    const ids = pathway.slots.map((s) => s.id);
    for (const field of DEFAULT_VOICE_LEAD_CAPTURE_REQUIRED_FIELDS) {
      expect(ids).toContain(field);
    }
  });

  test("required fields are marked required", () => {
    const pathway = createVoiceLeadCapturePathway({
      requiredFields: ["firstName", "email"],
      optionalFields: ["company"],
    });
    expect(pathway.slots.find((s) => s.id === "firstName")?.required).toBe(
      true,
    );
    expect(pathway.slots.find((s) => s.id === "company")?.required).toBe(
      false,
    );
  });

  test("submit state emits call-tool with all field slot ids", () => {
    const pathway = createVoiceLeadCapturePathway({
      optionalFields: [],
      requiredFields: ["firstName", "email"],
    });
    const submit = pathway.states.find((s) => s.id === "submit");
    const callTool = submit?.actions?.find((a) => a.kind === "call-tool");
    expect(callTool?.kind).toBe("call-tool");
    if (callTool?.kind === "call-tool") {
      expect(callTool.argsFromSlots).toEqual(["firstName", "email"]);
      expect(callTool.toolId).toBe("crm.create_lead");
    }
  });

  test("custom toolId is used in both tool registry and call-tool action", () => {
    const pathway = createVoiceLeadCapturePathway({ toolId: "crm.hubspot_lead" });
    const submit = pathway.states.find((s) => s.id === "submit");
    const callTool = submit?.actions?.find((a) => a.kind === "call-tool");
    if (callTool?.kind === "call-tool") {
      expect(callTool.toolId).toBe("crm.hubspot_lead");
    }
    expect(pathway.tools?.[0]?.id).toBe("crm.hubspot_lead");
  });

  test("greeting + closing text are customizable", () => {
    const pathway = createVoiceLeadCapturePathway({
      closing: "Bye!",
      greeting: "Welcome to Acme!",
    });
    const greet = pathway.states.find((s) => s.id === "greet");
    const sayAction = greet?.actions?.find((a) => a.kind === "say");
    if (sayAction?.kind === "say") {
      expect(sayAction.text).toBe("Welcome to Acme!");
    }
    const submit = pathway.states.find((s) => s.id === "submit");
    const closingSay = submit?.actions?.find((a) => a.kind === "say");
    if (closingSay?.kind === "say") {
      expect(closingSay.text).toBe("Bye!");
    }
  });

  test("vendor metadata is attached when supplied", () => {
    const pathway = createVoiceLeadCapturePathway({ vendor: "hubspot" });
    expect(pathway.metadata?.vendor).toBe("hubspot");
  });
});
