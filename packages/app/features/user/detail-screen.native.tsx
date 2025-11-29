'use client'

import React from 'react'
import { Screen, SectionList, Section, TitleText, CaptionText, Card } from 'app/ui/native'
import { useAuth } from 'app/provider/auth'

export function UserDetailScreen() {
  const { session } = useAuth()

  return (
    <Screen title="User" subtitle="Account details">
      <SectionList>
        <Section title="Profile">
          <Card>
            <TitleText size={18}>{session ? 'Signed in' : 'Not signed in'}</TitleText>
            <CaptionText>User ID: {session?.userId ?? '—'}</CaptionText>
            <CaptionText>Trainer ID: {session?.trainerId ?? '—'}</CaptionText>
          </Card>
        </Section>
      </SectionList>
    </Screen>
  )
}
