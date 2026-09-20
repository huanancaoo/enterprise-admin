"use client"
import { useMemo } from "react"
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search"
import { useI18n } from "fumadocs-ui/contexts/i18n"
import { useDocsSearch } from "fumadocs-core/search/client"
import { algoliaClient } from "fumadocs-core/search/client/algolia"
import { liteClient } from "algoliasearch/lite"

export default function CustomSearchDialog(props: SharedProps) {
  const { locale } = useI18n()
  const algolia = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID
    const apiKey = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY
    if (!appId || !apiKey) {
      throw new Error(
        "Algolia requires NEXT_PUBLIC_ALGOLIA_APP_ID and NEXT_PUBLIC_ALGOLIA_SEARCH_KEY"
      )
    }
    return liteClient(appId, apiKey)
  }, [])
  const { search, setSearch, query } = useDocsSearch({
    client: algoliaClient({
      client: algolia,
      indexName: "document",
      locale,
    }),
  })

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== "empty" ? query.data : null} />
        <SearchDialogFooter>
          <a
            href="https://algolia.com"
            rel="noreferrer noopener"
            className="text-fd-muted-foreground ms-auto text-xs"
          >
            Search powered by Algolia
          </a>
        </SearchDialogFooter>
      </SearchDialogContent>
    </SearchDialog>
  )
}
