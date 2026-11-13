import { ChapterLeaseLost, classifyChapterFailure, type ChapterFailure } from "./diagnostics";

type FinalStage = "assembly" | "final_save" | "complete";
export interface FinalAudio { audio: Buffer; duration: number; source?: Buffer }
export interface ChapterFinalization {
  assemble: (sections: Buffer[]) => Promise<FinalAudio>;
  save: (result: FinalAudio) => Promise<void>;
  complete: (result: FinalAudio) => Promise<void>;
  owned: () => Promise<boolean>;
  stage: (stage: FinalStage) => Promise<void>;
  failure: (event: ChapterFailure) => Promise<void>;
  success: (stage: FinalStage, attempt: number, elapsedMs: number) => void;
  wait?: (ms: number) => Promise<void>;
}

/** Retry only the failed finalization step; never call speech synthesis here. */
export async function finalizeChapter(sections: Buffer[], io: ChapterFinalization) {
  async function run<T>(stage: FinalStage, operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      if (!await io.owned()) throw new ChapterLeaseLost();
      await io.stage(stage);
      const started = Date.now();
      try {
        const result = await operation();
        io.success(stage, attempt, Date.now() - started);
        return result;
      } catch (error) {
        if (error instanceof ChapterLeaseLost) throw error;
        const classified = classifyChapterFailure(error);
        const willRetry = classified.retryable && attempt < 2;
        await io.failure({
          at: new Date().toISOString(), stage, code: classified.code, attempt,
          elapsedMs: Date.now() - started, willRetry,
        });
        if (!willRetry) throw error;
        await (io.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(3_000);
      }
    }
  }
  const result = await run("assembly", () => io.assemble(sections));
  await run("final_save", () => io.save(result));
  await run("complete", () => io.complete(result));
  return result;
}
