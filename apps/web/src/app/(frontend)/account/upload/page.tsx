import config from '@payload-config'
import { getPayload } from 'payload'
import React from 'react'

import { Stepper } from '../../../../components/Stepper'
import { UploadForm } from '../../../../components/UploadForm'
import { MONTHLY_PAGE_LIMIT, MONTHLY_UPLOAD_LIMIT } from '../../../../domain/uploadQuota'
import { getCurrentUser } from '../../../../lib/auth'
import { usageThisMonth } from '../../../../lib/uploadQuota'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Upload a book' }

export default async function UploadPage() {
  const user = await getCurrentUser()
  if (!user) return null

  // Shown before a file is chosen, not after. A reader who is out of
  // allowance should find out before they wait for a 60 MB upload.
  const isAdmin = Boolean(user.roles?.includes('admin'))
  const usage = isAdmin ? null : await usageThisMonth(await getPayload({ config }), user.id)

  return (
    <>
      <div className="wizard-head">
        <h2>Upload a Book</h2>
        <p>Prepare your manuscript for NobleSee</p>
      </div>

      <Stepper step={0} />

      <UploadForm
        quota={
          usage ? (
            <p className="hint hint--quota">
              {`This month: ${usage.uploads} of ${MONTHLY_UPLOAD_LIMIT} books, ${usage.pages.toLocaleString('en-US')} of ${MONTHLY_PAGE_LIMIT.toLocaleString('en-US')} pages. `}
              <span className="hint">Drafts are free — converting counts.</span>
            </p>
          ) : null
        }
      />
    </>
  )
}
