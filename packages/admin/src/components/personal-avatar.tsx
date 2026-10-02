import { useQuery } from "@tanstack/react-query"
import { getPersonalMediaContent } from "@workspace/api-client"
import { PersonalMediaSchema } from "@workspace/contracts"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { useAuthenticatedSession } from "../auth/authenticated-session"
import { useBlobImageRef } from "../hooks/use-blob-image-ref"

export function PersonalAvatar({
  image,
  name,
  organizationId,
  className,
}: {
  image?: string | null
  name: string
  organizationId?: string
  className?: string
}) {
  const session = useAuthenticatedSession()
  const reference = PersonalMediaSchema.shape.contentUrl.safeParse(image)
  const mediaId = reference.success ? reference.data.split("/")[4]! : null
  const content = useQuery({
    queryKey: ["personal-media", session?.user.id, organizationId, mediaId],
    enabled: Boolean(session && mediaId),
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await getPersonalMediaContent(
        mediaId!,
        organizationId ? { organizationId } : undefined,
        { signal, responseType: "blob" }
      )
      return result.data
    },
  })
  const blob = content.isError ? undefined : content.data
  const ref = useBlobImageRef(blob)
  return (
    <Avatar className={className} data-personal-avatar="">
      {blob ? (
        <img
          ref={ref}
          alt={name}
          className="aspect-square size-full rounded-full object-cover"
        />
      ) : (
        <AvatarFallback className="text-foreground">
          {name.trim().slice(0, 2).toUpperCase() || "U"}
        </AvatarFallback>
      )}
    </Avatar>
  )
}
