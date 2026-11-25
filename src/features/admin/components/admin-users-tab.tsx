"use client";

import { useMutation, useQuery } from "convex/react";
import { Award, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/dialog";
import type { UserRole } from "@/domain/types";
import { extractAppErrorMessage } from "@/features/lending/schema";
import { AdminPaginationControls, useCursorPagination } from "./admin-pagination";

interface AdminUserItem {
  _id: Id<"users">;
  displayName: string;
  email: string;
  role: UserRole;
  trustedLender: boolean;
  isDeleted: boolean;
  createdAt: number;
}

const PAGE_SIZE = 25;

export function AdminUsersTab() {
  const pagination = useCursorPagination();

  const page = useQuery(api.users.queries.listUsersForAdmin, {
    cursor: pagination.currentCursor,
    limit: PAGE_SIZE,
  });

  const setTrustedLender = useMutation(api.users.mutations.setTrustedLender);
  const [targetUser, setTargetUser] = useState<AdminUserItem | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const closeDialog = () => {
    if (submitting) return;
    setTargetUser(null);
    setDialogError(null);
  };

  const handleConfirmToggle = async () => {
    if (!targetUser) return;
    const nextValue = !targetUser.trustedLender;
    setSubmitting(true);
    setDialogError(null);
    try {
      await setTrustedLender({
        userId: targetUser._id,
        trustedLender: nextValue,
      });
      toast.success(
        nextValue
          ? `Granted Trusted Lender badge to ${targetUser.displayName}.`
          : `Revoked Trusted Lender badge from ${targetUser.displayName}.`,
      );
      setTargetUser(null);
    } catch (error) {
      setDialogError(extractAppErrorMessage(error, "Could not update Trusted Lender status."));
    } finally {
      setSubmitting(false);
    }
  };

  if (page === undefined) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="bg-muted h-16 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (page.items.length === 0) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-2 rounded-xl border p-10 text-center">
        <Users className="text-muted-foreground h-8 w-8" aria-hidden="true" />
        <p className="text-sm font-medium">No Users found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border-border bg-card overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-border bg-muted/40 text-muted-foreground border-b text-xs uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  User
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Role
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Trust Status
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {page.items.map((user) => (
                <tr key={user._id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{user.displayName}</div>
                    <div className="text-muted-foreground text-xs">
                      {user.isDeleted ? "Deleted User" : user.email || "No email"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={user.role === "admin" ? "default" : "secondary"}
                        className="gap-1 capitalize"
                      >
                        {user.role === "admin" ? (
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        ) : null}
                        {user.role}
                      </Badge>
                      {user.isDeleted ? <Badge variant="destructive">Deleted</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {user.trustedLender ? (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-sky-500/15 text-sky-800 dark:text-sky-300"
                      >
                        <Award className="h-3 w-3" aria-hidden="true" />
                        Trusted Lender
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Standard</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant={user.trustedLender ? "outline" : "secondary"}
                      disabled={user.isDeleted}
                      onClick={() => setTargetUser(user)}
                    >
                      {user.trustedLender ? "Revoke Badge" : "Grant Trusted Lender"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AdminPaginationControls
        pageIndex={pagination.pageIndex}
        isDone={page.isDone}
        onPrev={pagination.goPrev}
        onNext={() => pagination.goNext(page.continueCursor, page.isDone)}
      />

      <ModalDialog
        open={targetUser !== null}
        onOpenChange={(open) => (!open ? closeDialog() : null)}
        title={
          targetUser?.trustedLender ? "Revoke Trusted Lender badge?" : "Grant Trusted Lender badge?"
        }
        description={
          targetUser ? (
            <>
              {targetUser.trustedLender ? "Revoke" : "Grant"} the display-only{" "}
              <strong className="text-foreground">Trusted Lender</strong> badge for{" "}
              <strong className="text-foreground">{targetUser.displayName}</strong>. This badge is
              purely visual and does not alter lending rules. An Audit Log entry will be recorded.
            </>
          ) : null
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={targetUser?.trustedLender ? "destructive" : "default"}
              onClick={handleConfirmToggle}
              disabled={submitting}
            >
              {submitting
                ? "Saving..."
                : targetUser?.trustedLender
                  ? "Confirm Revoke"
                  : "Confirm Grant"}
            </Button>
          </>
        }
      >
        {dialogError ? (
          <Alert variant="destructive">
            <AlertDescription>{dialogError}</AlertDescription>
          </Alert>
        ) : null}
      </ModalDialog>
    </div>
  );
}
