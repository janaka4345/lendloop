import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const BACKEND_SLICES = ["listings", "lending", "users", "automation", "audit"];

/**
 * Generates ESLint flat-config boundary rules for each Convex domain slice.
 * A slice may only import another slice's public seam (`index` or `seam`),
 * never its internal modules at any nesting depth.
 */
function createBackendSliceBoundaryConfigs() {
  return BACKEND_SLICES.map((slice) => {
    const otherSlices = BACKEND_SLICES.filter((candidate) => candidate !== slice);
    const restrictedPatterns = otherSlices.flatMap((other) => [
      `**/${other}/*`,
      `**/${other}/**`,
      `!**/${other}/seam`,
      `!**/${other}/index`,
    ]);

    return {
      files: [`convex/${slice}/**/*.{ts,tsx}`],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: restrictedPatterns,
                message: `Cross-slice import forbidden: convex/${slice} may only import another slice's public seam (seam.ts or index.ts).`,
              },
            ],
          },
        ],
      },
    };
  });
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "convex/_generated/**",
    ".scratch/**",
    "reference-only-docs/**",
    ".agents/**",
  ]),
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    ignores: ["src/domain/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\./|@/domain(?:/|$)).*",
              message:
                "Pure domain modules (src/domain/**) must have zero external, framework, or runtime imports (only intra-domain imports are allowed).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_/]",
          message:
            "Build-time NEXT_PUBLIC_* env vars are forbidden. Read server runtime config or fetch GET /api/config instead.",
        },
        {
          selector:
            "MemberExpression[computed=true][object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.type='Literal'][property.value=/^NEXT_PUBLIC_/]",
          message:
            "Build-time NEXT_PUBLIC_* env vars are forbidden. Read server runtime config or fetch GET /api/config instead.",
        },
      ],
    },
  },
  ...createBackendSliceBoundaryConfigs(),
]);

export default eslintConfig;
