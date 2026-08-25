import Link from "next/link";
import React from "react";

import {
  ReaderEditPanel,
  type ReaderEditValues,
} from "../../../../components/admin/ReaderEditPanel";
import { getAdminUsers } from "../../../../lib/adminData";
import { isAdmin, requireAdmin } from "../../../../lib/adminAuth";
import { shortDate } from "../../../../lib/adminFormat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Readers" };

/**
 * Who is here, and what they have contributed.
 *
 * A list and a panel, selected with `?reader=`, as the Library and the
 * review queue are. The panel changes two things — the email and the
 * admin role — and both moved here from the CMS on 2026-08-24, which is
 * what made deleting `/cms` possible at all.
 *
 * Credits are shown and not editable, here or anywhere: the field
 * refuses writes at field level and only `lib/credits.ts` moves a
 * balance, against a ledger. See `actions/readers.ts` for what else is
 * deliberately absent.
 *
 * Still no Suspend / Restore, though the design carries one. There is
 * no account state behind it — adding one is a migration plus a refusal
 * at sign-in plus a decision about what a suspended reader is told —
 * and a button that only *looks* like it suspends someone is worse than
 * no button. It is a separate change, not a corner of this screen.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; reader?: string }>;
}) {
  const admin = await requireAdmin("/admin/users");
  const params = await searchParams;
  const query = (params.q ?? "").trim();

  const rows = await getAdminUsers(query);

  const selectedId = Number(params.reader);
  const selected = Number.isInteger(selectedId)
    ? (rows.find((row) => row.user.id === selectedId) ?? null)
    : null;

  // Keeps the search when a row is opened or closed, so an editor who
  // filtered to find somebody does not lose the filter by clicking them.
  const href = (reader: number | null) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (reader !== null) next.set("reader", String(reader));
    const search = next.toString();
    return search ? `/admin/users?${search}` : "/admin/users";
  };

  const editing: ReaderEditValues | null = selected
    ? {
        id: selected.user.id,
        email: selected.user.email,
        displayName: selected.user.displayName ?? "",
        isAdmin: isAdmin(selected.user),
        credits: selected.user.credits ?? 0,
        uploads: selected.uploads,
        published: selected.published,
        joined: shortDate(selected.user.createdAt, "—"),
      }
    : null;

  return (
    <div className="admin-split">
      <div className="admin-pane">
        <header className="admin-head">
          <div>
            <h1>Readers</h1>
            <p>
              {rows.length} registered{query ? ", matching" : ""}
            </p>
          </div>
          <form className="admin-filters" method="get" action="/admin/users">
            <label className="visually-hidden" htmlFor="reader-search">
              Search readers
            </label>
            <input
              id="reader-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search…"
            />
            <button type="submit" className="visually-hidden">
              Search
            </button>
          </form>
        </header>

        <div className="admin-scroll">
          {rows.length === 0 ? (
            <p className="admin-empty">No accounts match that.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Reader</th>
                  <th className="admin-col--md admin-num">Uploads</th>
                  <th className="admin-col--md admin-num">Published</th>
                  <th className="admin-col--lg admin-num">Credits</th>
                  <th className="admin-col--md">Joined</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ user, uploads, published }) => {
                  const name = user.displayName || user.email;
                  return (
                    <tr key={user.id}>
                      <td>
                        <span className="admin-bookcell">
                          <span className="admin-avatar" aria-hidden="true">
                            {Array.from(name.trim())[0] ?? "·"}
                          </span>
                          <span>
                            <Link
                              className="admin-rowlink"
                              href={href(user.id)}
                              scroll={false}
                            >
                              {name}
                            </Link>
                            {user.displayName ? <em>{user.email}</em> : null}
                          </span>
                        </span>
                      </td>
                      <td className="admin-col--md admin-quiet admin-num">
                        {uploads}
                      </td>
                      <td className="admin-col--md admin-quiet admin-num">
                        {published}
                      </td>
                      <td className="admin-col--lg admin-quiet admin-num">
                        {user.credits ?? 0}
                      </td>
                      <td className="admin-col--md admin-quiet">
                        {shortDate(user.createdAt, "—")}
                      </td>
                      <td>
                        {isAdmin(user) ? (
                          <span className="admin-chip-status admin-chip-status--approved">
                            Admin
                          </span>
                        ) : (
                          <span className="admin-quiet">Reader</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing ? (
        <ReaderEditPanel
          reader={editing}
          isSelf={editing.id === Number(admin.id)}
          closeHref={href(null)}
        />
      ) : null}
    </div>
  );
}
