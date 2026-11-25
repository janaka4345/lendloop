/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit_index from "../audit/index.js";
import type * as audit_queries from "../audit/queries.js";
import type * as audit_retention from "../audit/retention.js";
import type * as audit_seam from "../audit/seam.js";
import type * as automation_actions from "../automation/actions.js";
import type * as automation_crypto from "../automation/crypto.js";
import type * as automation_index from "../automation/index.js";
import type * as automation_internal from "../automation/internal.js";
import type * as automation_retention from "../automation/retention.js";
import type * as automation_seam from "../automation/seam.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lending_dto from "../lending/dto.js";
import type * as lending_index from "../lending/index.js";
import type * as lending_mutations from "../lending/mutations.js";
import type * as lending_queries from "../lending/queries.js";
import type * as lending_seam from "../lending/seam.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_authzChecks from "../lib/authzChecks.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_pagination from "../lib/pagination.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as listings_dto from "../listings/dto.js";
import type * as listings_images from "../listings/images.js";
import type * as listings_index from "../listings/index.js";
import type * as listings_mutations from "../listings/mutations.js";
import type * as listings_queries from "../listings/queries.js";
import type * as listings_retention from "../listings/retention.js";
import type * as listings_seam from "../listings/seam.js";
import type * as users_index from "../users/index.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";
import type * as users_seam from "../users/seam.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "audit/index": typeof audit_index;
  "audit/queries": typeof audit_queries;
  "audit/retention": typeof audit_retention;
  "audit/seam": typeof audit_seam;
  "automation/actions": typeof automation_actions;
  "automation/crypto": typeof automation_crypto;
  "automation/index": typeof automation_index;
  "automation/internal": typeof automation_internal;
  "automation/retention": typeof automation_retention;
  "automation/seam": typeof automation_seam;
  crons: typeof crons;
  http: typeof http;
  "lending/dto": typeof lending_dto;
  "lending/index": typeof lending_index;
  "lending/mutations": typeof lending_mutations;
  "lending/queries": typeof lending_queries;
  "lending/seam": typeof lending_seam;
  "lib/authz": typeof lib_authz;
  "lib/authzChecks": typeof lib_authzChecks;
  "lib/errors": typeof lib_errors;
  "lib/pagination": typeof lib_pagination;
  "lib/rateLimit": typeof lib_rateLimit;
  "listings/dto": typeof listings_dto;
  "listings/images": typeof listings_images;
  "listings/index": typeof listings_index;
  "listings/mutations": typeof listings_mutations;
  "listings/queries": typeof listings_queries;
  "listings/retention": typeof listings_retention;
  "listings/seam": typeof listings_seam;
  "users/index": typeof users_index;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
  "users/seam": typeof users_seam;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
