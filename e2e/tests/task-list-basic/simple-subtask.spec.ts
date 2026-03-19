import { expect, test } from '../../fixtures/test.fixture';

test.describe('Simple Subtask', () => {
  test('should create subtask with keyboard shortcut', async ({ page, workViewPage }) => {
    // Add parent task
    await workViewPage.addTask('Parent Task');

    const task = page.locator('task');

    await workViewPage.addSubTask(task, 'SubTask 1');

    // With tree-dnd, subtasks render in .folder-content as sibling items
    const subTask = page.locator('.folder-content task');
    await subTask.waitFor({ state: 'visible', timeout: 15000 });

    // Verify subtask was created with correct content
    const subtaskTitle = subTask.locator('task-title');
    await expect(subtaskTitle).toContainText('SubTask 1');
  });
});
