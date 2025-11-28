import { LegendList as LegendListBase, type LegendListProps } from '@legendapp/list'
import { Animated, Text, View, StyleSheet } from 'react-native'
import { type ReactElement, useCallback, useMemo } from 'react'
import { useTheme } from 'app/theme'

export type LegendSection<T> = { title: string; data: T[] }

type RenderItem<T> = (info: { item: T; index: number; section: LegendSection<T> }) => ReactElement | null

type LegendListItem<T> =
  | {
      kind: 'header'
      key: string
      title: string
      sectionIndex: number
      section: LegendSection<T>
    }
  | {
      kind: 'item'
      key: string
      item: T
      itemIndex: number
      sectionIndex: number
      section: LegendSection<T>
    }

type Props<T> = Omit<LegendListProps<LegendListItem<T>>, 'data' | 'renderItem' | 'keyExtractor'> & {
  sections: LegendSection<T>[]
  renderItem: RenderItem<T>
  keyExtractor?: (item: T, index: number) => string
  stickySectionHeadersEnabled?: boolean
}

export function LegendList<T>({
  sections,
  renderItem,
  keyExtractor,
  stickySectionHeadersEnabled,
  ListHeaderComponent,
  estimatedItemSize,
  renderScrollComponent,
  ...rest
}: Props<T>) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const { data, stickyIndices } = useMemo(() => {
    const flattened: LegendListItem<T>[] = []
    const sticky: number[] = []

    sections.forEach((section, sectionIndex) => {
      const headerIndex = flattened.length
      flattened.push({
        kind: 'header',
        key: `header-${sectionIndex}-${section.title}`,
        title: section.title,
        sectionIndex,
        section,
      })
      sticky.push(headerIndex)

      section.data.forEach((item, itemIndex) => {
        const key = keyExtractor ? keyExtractor(item, itemIndex) : `item-${sectionIndex}-${itemIndex}`
        flattened.push({
          kind: 'item',
          key,
          item,
          itemIndex,
          sectionIndex,
          section,
        })
      })
    })

    return { data: flattened, stickyIndices: sticky }
  }, [keyExtractor, sections])

  const headerOffset = ListHeaderComponent ? 1 : 0
  const sticky = stickySectionHeadersEnabled ? stickyIndices.map(index => index + headerOffset) : undefined

  const renderLegendItem = useCallback(
    ({ item }: { item: LegendListItem<T>; index: number }) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.header}>
            <View style={styles.legendBubble}>
              <Text style={styles.legendText}>{item.title}</Text>
            </View>
            <View style={styles.rule} />
          </View>
        )
      }
      return renderItem({ item: item.item, index: item.itemIndex, section: item.section })
    },
    [renderItem, styles.header, styles.legendBubble, styles.legendText, styles.rule]
  )

  // LegendList can ask for an item type while containers recycle and data shrinks; guard so we don't crash on undefined.
  const getItemType = useCallback((item?: LegendListItem<T>) => item?.kind ?? 'unknown', [])

  const resolvedRenderScrollComponent =
    renderScrollComponent ?? (stickySectionHeadersEnabled ? (props => <Animated.ScrollView {...props} />) : undefined)

  const LegendComponent = LegendListBase as unknown as React.ComponentType<
    LegendListProps<LegendListItem<T>>
  >

  return (
    <LegendComponent
      data={data}
      renderItem={renderLegendItem}
      keyExtractor={item => item.key}
      getItemType={getItemType}
      stickyIndices={sticky}
      estimatedItemSize={(estimatedItemSize ?? 96) as number}
      ListHeaderComponent={
        ListHeaderComponent as LegendListProps<LegendListItem<T>>['ListHeaderComponent']
      }
      renderScrollComponent={
        resolvedRenderScrollComponent as LegendListProps<LegendListItem<T>>['renderScrollComponent']
      }
      {...rest}
    />
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xs,
    },
    legendBubble: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      minWidth: 36,
      alignItems: 'center',
    },
    legendText: {
      fontWeight: '800',
      color: theme.colors.text,
    },
    rule: {
      flex: 1,
      height: 1,
      backgroundColor: theme.colors.border,
    },
  })
