import type { CharacterDTO } from 'lumiverse-spindle-types'

/** Only the character fields used by the nudge settings UI. */
export type CharacterInfo = Pick<CharacterDTO, 'id' | 'name' | 'image_id'>

export function toCharacterInfo(character: CharacterInfo): CharacterInfo {
  const { id, name, image_id } = character
  return { id, name, image_id }
}
