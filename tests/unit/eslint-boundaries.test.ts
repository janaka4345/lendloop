import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

describe("ESLint modular-monolith import boundaries", () => {
  const eslint = new ESLint();

  it("forbids framework, runtime, third-party, and escaping relative imports in pure domain modules", async () => {
    const [result] = await eslint.lintText(
      [
        `import { NextResponse } from "next/server";`,
        `import fs from "node:fs";`,
        `import { z } from "zod";`,
        `import { validateRuntimeConfig } from "../lib/runtime-config";`,
        `export const x = [NextResponse, fs, z, validateRuntimeConfig];`,
      ].join("\n"),
      { filePath: "src/domain/example.ts" },
    );

    const restrictionErrors = result.messages.filter(
      (msg) => msg.ruleId === "no-restricted-imports",
    );
    expect(restrictionErrors).toHaveLength(4);
  }, 20_000);

  it("allows pure intra-domain imports within src/domain", async () => {
    const [result] = await eslint.lintText(
      `import type { DomainSlice } from "./index";\nexport const slice: DomainSlice = "listings";\n`,
      { filePath: "src/domain/example.ts" },
    );

    const restrictionErrors = result.messages.filter(
      (msg) => msg.ruleId === "no-restricted-imports",
    );
    expect(restrictionErrors).toHaveLength(0);
  });

  it("forbids backend slices from importing another slice's internal modules at any depth", async () => {
    const [shallowResult] = await eslint.lintText(
      `import { secretHelper } from "../lending/internal/helpers";\nexport const y = secretHelper;\n`,
      { filePath: "convex/listings/mutations.ts" },
    );
    const [deepResult] = await eslint.lintText(
      `import { secretHelper } from "../../../lending/internal/helpers";\nexport const z = secretHelper;\n`,
      { filePath: "convex/listings/sub/deep/mutations.ts" },
    );

    expect(
      shallowResult.messages.filter((msg) => msg.ruleId === "no-restricted-imports"),
    ).toHaveLength(1);
    expect(
      deepResult.messages.filter((msg) => msg.ruleId === "no-restricted-imports"),
    ).toHaveLength(1);
  });

  it("allows backend slices to import another slice's public seam", async () => {
    const [result] = await eslint.lintText(
      `import { getActiveLoansForListing } from "../lending/seam";\nexport const y = getActiveLoansForListing;\n`,
      { filePath: "convex/listings/mutations.ts" },
    );

    const restrictionErrors = result.messages.filter(
      (msg) => msg.ruleId === "no-restricted-imports",
    );
    expect(restrictionErrors).toHaveLength(0);
  });

  it("forbids NEXT_PUBLIC_* env var access in src/**", async () => {
    const [result] = await eslint.lintText(
      [
        `export const a = process.env.NEXT_PUBLIC_CONVEX_URL;`,
        `export const b = process.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];`,
        `export const c = process.env.CONVEX_URL;`,
      ].join("\n"),
      { filePath: "src/lib/example.ts" },
    );

    const syntaxErrors = result.messages.filter((msg) => msg.ruleId === "no-restricted-syntax");
    expect(syntaxErrors).toHaveLength(2);
  });
});
