import React from 'react'

import { readerName, type ReaderIdentity } from '../domain/avatar'
import { Avatar } from './Avatar'

export function AccountLink({ identity }: { identity: ReaderIdentity }) {
  const name = readerName(identity)

  return (
    <a className="account-link" href="/account">
      <Avatar identity={identity} />
      <span className="account-link__name">{name}</span>
      <span className="visually-hidden">{`Signed in as ${name}. Your account.`}</span>
    </a>
  )
}
