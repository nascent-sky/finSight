import { generateValidated } from "./modelValidation.js"
import { isNarrativeContradiction, verifiedEvidenceStatement } from "./narrativeConsistency.js"
import { appendOwnedBlocks, selectPreparedBlocks } from "./responseComposition.js"
import { responsePresentation } from "../../src/features/finance-ai/responseBlocks.js"

// Recover only after an observed factual contradiction. Ordinary provider,
// privacy, auth, tool and JSON errors retain their existing error behavior.
export async function generateConsistentResponse({ generate, validate, recover, repairOtherValidation = true, ...options }) {
  let contradiction, repairAttempted = false
  try {
    return await generateValidated({ ...options,
      generate: async (args) => {
        if (contradiction) repairAttempted = true
        try { return await generate(args) } catch (error) { if (!repairOtherValidation && !contradiction) error.repairable = false; throw error }
      },
      validate: (output) => {
        try { return validate(output) } catch (error) {
          if (isNarrativeContradiction(error)) contradiction = error
          else if (!repairOtherValidation) error.repairable = false
          throw error
        }
      },
    })
  } catch (error) {
    if (!contradiction || options.args.signal?.aborted || !["model_output", "provider"].includes(error.origin)) throw error
    return recover({ kind: "narrative_consistency", rule: contradiction.validation.rule, repairAttempted, retryable: true, outcome: error.origin === "provider" ? "provider_failed" : "validation_failed" })
  }
}

export function verifiedNarrativeRecovery({ evidence, catalog, defaultBlocks, policies = [], allowedActions, ownedBlocks = [], maxBlocks = 16, recordsAppended = false }, recovery) {
  const answer = evidence.map(verifiedEvidenceStatement).join("\n")
  const prepared = selectPreparedBlocks({ catalog, defaultBlocks, suggested: [], policies, recordsAppended }).map((resource) => resource.block)
  const actions = allowedActions.length ? [{ type: "actions", ids: allowedActions }] : []
  const blocks = appendOwnedBlocks([{ type: "paragraph", text: answer }, ...prepared.slice(0, Math.max(0, maxBlocks - 1 - actions.length)), ...actions], ownedBlocks)
  const presentation = responsePresentation(blocks)
  return { answer, presentation, cards: presentation.blocks.filter((block) => block.type === "comparison").map((block) => block.card), source: "local_verified", recovery, cloud: { status: "unavailable", stage: "explanation", reason: "narrative_consistency", correctionAttempted: recovery.repairAttempted } }
}
