"use client"

import { useCallback, useEffect, useMemo, type AnchorHTMLAttributes } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  isStatusFilter,
  normalizeStatus,
  statusColors,
  statusOptions,
  type StatusFilter,
} from 'app/features/clients/shared'
import type { Client } from 'app/services/api'
import { RefreshCw, Search } from 'lucide-react'

type Props = {
  clients: Client[]
}

const PAGE_SIZE_DEFAULT = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50]

export function ClientsGrid({ clients }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const quickFilterParam = searchParams.get('q') ?? ''
  const statusParam = searchParams.get('status')
  const pageParam = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const pageSizeParam = Number.parseInt(searchParams.get('pageSize') ?? '', 10)

  const quickFilter = quickFilterParam
  const statusFilter: StatusFilter | 'all' = isStatusFilter(statusParam) ? statusParam : 'all'
  const pageSize =
    Number.isFinite(pageSizeParam) && PAGE_SIZE_OPTIONS.includes(pageSizeParam)
      ? pageSizeParam
      : PAGE_SIZE_DEFAULT

  const updateQuery = useCallback(
    (updates: {
      q?: string
      status?: StatusFilter | 'all'
      page?: number
      pageSize?: number
    }) => {
      const params = new URLSearchParams(searchParams.toString())

      if (updates.q !== undefined) {
        if (updates.q.trim()) params.set('q', updates.q.trim())
        else params.delete('q')
      }

      if (updates.status !== undefined) {
        if (updates.status === 'all') params.delete('status')
        else params.set('status', updates.status)
      }

      if (updates.pageSize !== undefined) {
        params.set('pageSize', String(updates.pageSize))
      }

      if (updates.page !== undefined) {
        params.set('page', String(updates.page))
      }

      const queryString = params.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const handleSearchChange = useCallback(
    (value: string) => {
      updateQuery({ q: value, page: 1 })
    },
    [updateQuery]
  )

  const handleStatusChange = useCallback(
    (value: StatusFilter | 'all') => {
      updateQuery({ status: value, page: 1 })
    },
    [updateQuery]
  )

  const handlePageSizeChange = useCallback(
    (value: number) => {
      updateQuery({ pageSize: value, page: 1 })
    },
    [updateQuery]
  )

  const parsedPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const filteredClients = useMemo(() => {
    const term = quickFilter.trim().toLowerCase()

    return clients.filter((client) => {
      const matchesStatus =
        statusFilter === 'all' || normalizeStatus(client.status) === statusFilter

      if (!matchesStatus) return false

      if (!term) return true

      const haystack = [
        client.firstName,
        client.lastName,
        `${client.firstName ?? ''} ${client.lastName ?? ''}`,
        client.email,
        client.company,
        client.mobileNumber,
      ]
        .filter(Boolean)
        .map((value) => value!.toLowerCase())

      return haystack.some((value) => value.includes(term))
    })
  }, [clients, quickFilter, statusFilter])

  const totalPages = useMemo(() => {
    if (filteredClients.length === 0) return 1
    return Math.max(1, Math.ceil(filteredClients.length / pageSize))
  }, [filteredClients.length, pageSize])

  const currentPage = Math.min(Math.max(parsedPage, 1), totalPages)

  useEffect(() => {
    if (currentPage !== parsedPage) {
      updateQuery({ page: currentPage })
    }
  }, [currentPage, parsedPage, updateQuery])

  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredClients.slice(start, start + pageSize)
  }, [filteredClients, currentPage, pageSize])

  const handleRowClick = useCallback(
    (id?: string) => {
      if (!id) return
      router.push(`/clients/${id}`)
    },
    [router]
  )

  const resetFilters = useCallback(() => {
    updateQuery({ q: '', status: 'all', page: 1, pageSize: PAGE_SIZE_DEFAULT })
  }, [updateQuery])

  const showingStart = filteredClients.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const showingEnd = Math.min(filteredClients.length, currentPage * pageSize)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="w-full sm:w-80">
          <Input
            value={quickFilter}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search name, email, company"
            leadingIcon={<Search className="size-4" aria-hidden />}
            aria-label="Search clients"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="clients-status-filter">
              Status
            </label>
            <NativeSelect
              id="clients-status-filter"
              value={statusFilter}
              onChange={(event) => handleStatusChange(event.target.value as StatusFilter | 'all')}
              className="min-w-[140px]"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="clients-page-size">
              Rows
            </label>
            <NativeSelect
              id="clients-page-size"
              value={pageSize}
              onChange={(event) => handlePageSizeChange(Number(event.target.value))}
              className="w-24"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </div>

          <Button variant="outline" size="sm" onClick={resetFilters} className="shrink-0">
            <RefreshCw className="mr-2 size-4" aria-hidden /> Reset
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Mobile</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedClients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No clients match your filters.
                </TableCell>
              </TableRow>
            ) : (
              paginatedClients.map((client) => {
                const status = normalizeStatus(client.status)
                const initials =
                  (client.firstName?.[0] ?? '') + (client.lastName?.[0] ?? '') || '?'

                return (
                  <TableRow
                    key={client.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    onClick={() => handleRowClick(client.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleRowClick(client.id)
                      }
                    }}
                  >
                    <TableCell className="py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-9 w-9 border-0 shadow-xs">
                          <AvatarFallback
                            className="text-xs font-semibold text-background"
                            style={{ backgroundColor: statusColors[status] }}
                          >
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-sm">
                            {`${client.firstName ?? ''} ${client.lastName ?? ''}`.trim() ||
                              'Unnamed client'}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {client.email || client.mobileNumber || 'No contact info'}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="truncate"
                        style={{
                          color: statusColors[status],
                          borderColor: `${statusColors[status]}33`,
                          backgroundColor: `${statusColors[status]}15`,
                        }}
                      >
                        {statusOptions.find((option) => option.id === status)?.label ?? 'Current'}
                      </Badge>
                    </TableCell>
                    <TableCell className="truncate">{client.company ?? '—'}</TableCell>
                    <TableCell className="truncate">{client.email ?? '—'}</TableCell>
                    <TableCell className="truncate">{client.mobileNumber ?? '—'}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          {filteredClients.length > 0 ? (
            <>Showing {showingStart}–{showingEnd} of {filteredClients.length}</>
          ) : (
            'No clients found'
          )}
        </div>

        <Pagination className="justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  if (currentPage > 1) updateQuery({ page: currentPage - 1 })
                }}
              />
            </PaginationItem>

            {Array.from({ length: totalPages }).map((_, index) => {
              const pageNumber = index + 1
              // Show first, last, current, and neighbors; ellipsis otherwise.
              const isEdge = pageNumber === 1 || pageNumber === totalPages
              const isNearCurrent = Math.abs(pageNumber - currentPage) <= 1
              if (!isEdge && !isNearCurrent) {
                if (pageNumber === currentPage - 2 || pageNumber === currentPage + 2) {
                  return (
                    <PaginationItem key={`ellipsis-${pageNumber}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  )
                }
                return null
              }

              const hrefParams = new URLSearchParams(searchParams.toString())
              hrefParams.set('page', String(pageNumber))

              return (
                <PaginationItem key={pageNumber}>
                  <PaginationLink
                    href={`${pathname}?${hrefParams.toString()}`}
                    isActive={pageNumber === currentPage}
                    onClick={(event) => {
                      event.preventDefault()
                      updateQuery({ page: pageNumber })
                    }}
                    render={(props) => {
                      const anchorProps = props as AnchorHTMLAttributes<HTMLAnchorElement>
                      return (
                        <Link
                          {...anchorProps}
                          href={anchorProps.href ?? '#'}
                          scroll={false}
                        />
                      )
                    }}
                  >
                    {pageNumber}
                  </PaginationLink>
                </PaginationItem>
              )
            })}

            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  if (currentPage < totalPages) updateQuery({ page: currentPage + 1 })
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
