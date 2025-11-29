'use client'

import React from 'react'
import { Screen, SectionList, Section, Card, TitleText, CaptionText, PrimaryButton } from 'app/ui/native'

export function FinanceScreen() {
  return (
    <Screen title="Finance" subtitle="Revenue and overdue items">
      <SectionList>
        <Section title="Revenue snapshot">
          <Card>
            <TitleText size={18}>Coming soon</TitleText>
            <CaptionText>
              SwiftUI-native finance charts will land after the data hooks are mapped to the new UI kit.
            </CaptionText>
          </Card>
        </Section>

        <Section title="Overdue items">
          <Card>
            <CaptionText>Track overdue payments and send reminders.</CaptionText>
            <PrimaryButton onPress={() => {}} disabled>
              Remind clients
            </PrimaryButton>
          </Card>
        </Section>
      </SectionList>
    </Screen>
  )
}
