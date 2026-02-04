import { validate as validateUuid, NIL as NIL_UUID } from 'uuid'

export { NIL_UUID }

export const uuidOrNil = (value: string) => (validateUuid(value) ? value : NIL_UUID)
