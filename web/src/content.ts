/* Course content — single source of truth shared with the agent judge.
   Lives at /content/lessons.json so the agent can read the same file. */
// @ts-ignore JSON import resolved by Vite + resolveJsonModule
import data from '../../content/lessons.json'

export interface LessonTest { name: string; visible?: boolean; pass?: boolean }

export interface Lesson {
  id: number
  n: string
  title: string
  tag: string
  kind: 'reading' | 'code'
  port?: number
  brief: string
  hints: string
  video?: { id: string; start: number; end: number; label?: string }
  starters: { python?: string; csharp?: string }
  tests: LessonTest[]
}

export const LESSONS = ((data as { lessons: Lesson[] }).lessons) ?? []

/** Coding lessons become the playable rounds, in order. */
export const ROUNDS = LESSONS.filter(l => l.kind === 'code')

export const PY_CODE: string = ROUNDS[0]?.starters?.python ?? ''
export const CS_CODE: string = ROUNDS[0]?.starters?.csharp ?? ''