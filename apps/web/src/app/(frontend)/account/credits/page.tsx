import config from '@payload-config'
import { getPayload } from 'payload'
import React from 'react'

import { BuyCredits } from '../../../../components/BuyCredits'
import { CREDIT_PRICE_USD, isResumable } from '../../../../domain/creditPurchases'
import { getCurrentUser } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Buy credits' }

export default async function BuyCreditsPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const payload = await getPayload({ config })
  const recent = await payload.find({
    collection: 'credit-purchases',
    where: { and: [{ user: { equals: user.id } }, { status: { equals: 'pending' } }] },
    sort: '-createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const open = recent.docs[0]
  const resumable =
    open && open.payAddress && open.payAmount && isResumable(open, new Date()) ? open : null

  return (
    <>
      <div className="section-head">
        <h2>Buy credits</h2>
      </div>
      <p>{`$${CREDIT_PRICE_USD} USD = 1 credit. Credits never expire. Reading is always free.`}</p>

      <BuyCredits
        resume={
          resumable
            ? {
                orderId: resumable.orderId,
                credits: resumable.credits,
                priceUsd: resumable.priceUsd,
                payCurrency: resumable.payCurrency,
                payAddress: resumable.payAddress!,
                payAmount: resumable.payAmount!,
                expiresAt: resumable.expiresAt!,
              }
            : null
        }
      />
    </>
  )
}
