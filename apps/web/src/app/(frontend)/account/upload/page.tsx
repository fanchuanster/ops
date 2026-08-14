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
        A scanned PDF, an ordinary PDF, a DOCX or a plain text file. It is read, rebuilt as an
        editable DOCX master, and from that master you get the same things the library offers —
        a clean EPUB, PDFs in three sizes, and delivery to your Kindle.
      </p>
      <p>
        Just the file for now. We will read whatever it says about itself — title, author,
        language — and show you the details to check before anything else happens.
      </p>
      <p className="hint">
        Your upload is <strong>private to you</strong> and stays that way unless you ask for it to
        be published and an administrator approves it. Sending your own book to your own device is
        free — it is your book.
      </p>

      {usage ? (
        <p className="hint">
          {`This month: ${usage.uploads} of ${MONTHLY_UPLOAD_LIMIT} books converted, ${usage.pages} of ${MONTHLY_PAGE_LIMIT} pages. `}
          Uploading costs nothing — a draft you never convert is not counted, and the allowance
          resets at the start of each month.
        </p>
      ) : null}

      <UploadForm />
    </>
  )
}
