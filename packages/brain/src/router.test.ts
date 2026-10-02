import { describe, expect, it } from "vitest";
import { RoutingError, route } from "./router.ts";

describe("route", () => {
  it.each(["mail_content", "personal", "no_personal_data"] as const)(
    "sends %s to the local model by default",
    (dataClass) => {
      expect(route({ dataClass }, { euApiConfigured: true })).toBe("local");
    },
  );

  it("allows the EU API only for data with nothing personal, when configured", () => {
    expect(
      route({ dataClass: "no_personal_data", prefer: "eu_api" }, { euApiConfigured: true }),
    ).toBe("eu_api");
  });
});

describe("route — adversarial", () => {
  it.each(["mail_content", "personal"] as const)(
    "refuses to send %s to the EU API, even when asked and configured",
    (dataClass) => {
      expect(() => route({ dataClass, prefer: "eu_api" }, { euApiConfigured: true })).toThrow(
        RoutingError,
      );
    },
  );

  it("refuses the EU API when it is not configured", () => {
    expect(() =>
      route({ dataClass: "no_personal_data", prefer: "eu_api" }, { euApiConfigured: false }),
    ).toThrow(RoutingError);
  });

  it.each(["", "public", "MAIL_CONTENT"])("refuses the unknown data class %j", (dataClass) => {
    expect(() => route({ dataClass: dataClass as never }, { euApiConfigured: true })).toThrow(
      RoutingError,
    );
  });
});
