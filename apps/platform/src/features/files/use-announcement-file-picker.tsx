import { useEffect, useRef, useState } from "react"
import type { AnnouncementDetail } from "@workspace/contracts"
import { useFileScope } from "./queries"
import {
  AnnouncementFilePickerDialog,
  type Request,
} from "./announcement-file-picker"
type Attachment = AnnouncementDetail["attachments"][number]
export function useAnnouncementFilePicker() {
  const scope = useFileScope(),
    [request, setRequest] = useState<Request | null>(null),
    pending = useRef<Request | null>(null)
  useEffect(
    () => () => {
      pending.current?.complete(null)
    },
    [scope.contentKey]
  )
  const pick = (kind: Request["kind"], signal: AbortSignal) =>
    new Promise<Attachment | null>((resolve) => {
      if (signal.aborted) {
        resolve(null)
        return
      }
      const complete = (value: Attachment | null) => {
        signal.removeEventListener("abort", abort)
        pending.current = null
        setRequest(null)
        resolve(value)
      }
      const abort = () => complete(null)
      pending.current?.complete(null)
      const next = { kind, complete }
      pending.current = next
      setRequest(next)
      signal.addEventListener("abort", abort, { once: true })
    })
  return {
    pick,
    dialog: request ? (
      <AnnouncementFilePickerDialog
        key={scope.contentKey}
        scope={scope}
        request={request}
      />
    ) : null,
  }
}
