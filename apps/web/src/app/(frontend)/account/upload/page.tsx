import config from '@payload-config'
import { getPayload } from 'payload'
import React from 'react'

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
      <div className="section-head">
        <h2>Upload a book</h2>
      </div>

      <p>
        A scanned PDF, an ordinary PDF, a DOCX or plain text. You get back a clean EPUB, PDFs in
        three sizes, and an editable DOCX master.
      </p>
      <p className="hint">
        Just the file — we read the details from it and show them to you next. Uploads are
        private to you, and free to send to your own device.
      </p>

      {usage ? (
        <p className="hint">
          {`This month: ${usage.uploads} of ${MONTHLY_UPLOAD_LIMIT} books, ${usage.pages} of ${MONTHLY_PAGE_LIMIT} pages. `}
          Drafts are free; only converting counts.
        </p>
      ) : null}

      <UploadForm />
    </>
  )
}
