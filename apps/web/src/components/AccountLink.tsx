import React from 'react'

import { readerName, type ReaderIdentity } from '../domain/avatar'
import { Avatar } from './Avatar'

/**
 * Who you are signed in as, top right.
 *
 * A link, not a menu. It briefly was a dropdown; the account page grew
 * its own sidebar of sections, and having the same destinations in two
 * places meant one of them would drift. Clicking your own face going
 * straight to your own account is also the shorter path to everything
 * the dropdown listed.
 *
 * A server component: nothing here needs to open, close or remember.
 */
export function AccountLink({ identity }: { identity: ReaderIdentity }) {
  const name = readerName(identity)

  return (
    <a className="account-link" href="/account">
      <Avatar identity={identity} />
      {/* Hidden below the header's breakpoint, where the circle alone
          has to carry it. The accessible name never disappears. */}
      <span className="account-link__name">{name}</span>
      <span className="visually-hidden">{`Signed in as ${name}. Your account.`}</span>
    </a>
  )
}
