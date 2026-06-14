import type { Prompt, PromptCategory, PromptsResponse } from "./types.js";

export class HingePromptsManager {
  readonly promptsData: PromptsResponse;
  private readonly promptsById = new Map<string, Prompt>();
  private readonly categoriesBySlug = new Map<string, PromptCategory>();

  constructor(promptsData: PromptsResponse) {
    this.promptsData = promptsData;
    for (const prompt of promptsData.prompts ?? []) {
      this.promptsById.set(prompt.id, prompt);
    }
    for (const category of promptsData.categories ?? []) {
      this.categoriesBySlug.set(category.slug, category);
    }
  }

  getPromptById(promptId: string): Prompt | undefined {
    return this.promptsById.get(promptId);
  }

  getCategoryBySlug(slug: string): PromptCategory | undefined {
    return this.categoriesBySlug.get(slug);
  }

  getPromptsByCategory(categorySlug: string): Prompt[] {
    return (this.promptsData.prompts ?? []).filter((prompt) => prompt.categories.includes(categorySlug));
  }

  getSelectablePrompts(): Prompt[] {
    return (this.promptsData.prompts ?? []).filter((prompt) => prompt.isSelectable);
  }

  getNewPrompts(): Prompt[] {
    return (this.promptsData.prompts ?? []).filter((prompt) => prompt.isNew);
  }

  searchPrompts(query: string): Prompt[] {
    const lower = query.toLowerCase();
    return (this.promptsData.prompts ?? []).filter((prompt) =>
      prompt.prompt.toLowerCase().includes(lower) || prompt.placeholder.toLowerCase().includes(lower)
    );
  }

  getPromptDisplayText(promptId: string): string {
    return this.getPromptById(promptId)?.prompt ?? "Unknown Question";
  }

  getVisibleCategories(): PromptCategory[] {
    return (this.promptsData.categories ?? []).filter((category) => category.isVisible);
  }
}
