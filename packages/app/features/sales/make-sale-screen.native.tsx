'use client'

import React, { useState } from 'react'
import {
  Screen,
  SectionList,
  Section,
  TextField,
  PrimaryButton,
  CaptionText,
  Card,
  Toggle,
  TitleText,
} from 'app/ui/native'

export function MakeSaleScreen() {
  const [amount, setAmount] = useState('')
  const [client, setClient] = useState('')
  const [notes, setNotes] = useState('')
  const [sendReceipt, setSendReceipt] = useState(true)

  return (
    <Screen title="Make sale" subtitle="Charge a one-off payment">
      <SectionList>
        <Section title="Sale details">
          <Card>
            <TextField
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="$120.00"
            />
            <TextField label="Client" value={client} onChangeText={setClient} placeholder="Client name" />
            <TextField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional note for the receipt"
            />
            <Toggle value={sendReceipt} onValueChange={setSendReceipt} label="Send receipt" />
            <PrimaryButton onPress={() => {}}>
              Submit (stub)
            </PrimaryButton>
          </Card>
        </Section>
        <Section title="Status">
          <TitleText size={17}>SwiftUI-native surface</TitleText>
          <CaptionText>Payment processing wiring will follow after UI migration.</CaptionText>
        </Section>
      </SectionList>
    </Screen>
  )
}
