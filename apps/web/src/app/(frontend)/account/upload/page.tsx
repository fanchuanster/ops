import React from 'react'

import { UploadForm } from '../../../../components/UploadForm'
import { getCollections } from '../../../../lib/catalog'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Upload a book' }

export default async function UploadPage() {
  const collections = await getCollections()

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
      <p className="hint">
        Your upload is <strong>private to you</strong> and stays that way unless you ask for it to
        be published and an administrator approves it. Sending your own book to your own device is
        free — it is your book.
      </p>

      <UploadForm
        collections={collections.map((c) => ({ id: Number(c.id), title: c.title }))}
      />
    </>
  )
}
