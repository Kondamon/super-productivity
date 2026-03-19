import { tasksToTreeNodes, getAfterTaskIdFromInstruction } from './task-list-tree.util';
import { HideSubTasksMode, Task, TaskWithSubTasks } from '../task.model';
import { MoveInstruction } from '../../../ui/tree-dnd/tree.types';

const createMockTask = (overrides: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks =>
  ({
    id: 'task-1',
    title: 'Test Task',
    subTasks: [],
    isDone: false,
    _hideSubTasksMode: undefined,
    parentId: null,
    projectId: 'proj-1',
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    tagIds: [],
    created: Date.now(),
    attachments: [],
    ...overrides,
  }) as TaskWithSubTasks;

const createMockSubTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'sub-1',
    title: 'Subtask',
    isDone: false,
    parentId: 'task-1',
    projectId: 'proj-1',
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    tagIds: [],
    created: Date.now(),
    attachments: [],
    ...overrides,
  }) as Task;

const createMoveInstruction = (
  overrides: Partial<MoveInstruction> = {},
): MoveInstruction => ({
  itemId: 'item-1',
  targetId: 'target-1',
  where: 'after',
  ...overrides,
});

describe('tasksToTreeNodes', () => {
  it('should convert top-level tasks to folder nodes with children array', () => {
    const tasks = [createMockTask({ id: 'task-a' })];
    const result = tasksToTreeNodes(tasks, null);

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('task-a');
    expect(Array.isArray(result[0].children)).toBe(true);
  });

  it('should create subtask nodes without children property', () => {
    const subTask = createMockSubTask({ id: 'sub-a', parentId: 'task-a' });
    const task = createMockTask({
      id: 'task-a',
      subTasks: [subTask],
      subTaskIds: ['sub-a'],
    });
    const result = tasksToTreeNodes([task], null);

    expect(result[0].children!.length).toBe(1);
    expect(result[0].children![0].id).toBe('sub-a');
    expect(result[0].children![0].children).toBeUndefined();
  });

  it('should hide all subtasks when HideSubTasksMode.HideAll is set', () => {
    const subTask = createMockSubTask({ id: 'sub-a' });
    const task = createMockTask({
      id: 'task-a',
      subTasks: [subTask],
      subTaskIds: ['sub-a'],
      _hideSubTasksMode: HideSubTasksMode.HideAll,
    });
    const result = tasksToTreeNodes([task], null);

    expect(result[0].children!.length).toBe(0);
    expect(result[0].expanded).toBe(false);
  });

  it('should filter done subtasks with HideDone but keep current task', () => {
    const doneSub = createMockSubTask({ id: 'sub-done', isDone: true });
    const undoneSub = createMockSubTask({ id: 'sub-undone', isDone: false });
    const currentDoneSub = createMockSubTask({
      id: 'sub-current',
      isDone: true,
    });
    const task = createMockTask({
      id: 'task-a',
      subTasks: [doneSub, undoneSub, currentDoneSub],
      subTaskIds: ['sub-done', 'sub-undone', 'sub-current'],
      _hideSubTasksMode: HideSubTasksMode.HideDone,
    });

    const result = tasksToTreeNodes([task], 'sub-current');
    const childIds = result[0].children!.map((child) => child.id);

    expect(childIds).toContain('sub-undone');
    expect(childIds).toContain('sub-current');
    expect(childIds).not.toContain('sub-done');
    expect(result[0].children!.length).toBe(2);
  });

  it('should include all subtasks when no hide mode is set', () => {
    const doneSub = createMockSubTask({ id: 'sub-done', isDone: true });
    const undoneSub = createMockSubTask({ id: 'sub-undone', isDone: false });
    const task = createMockTask({
      id: 'task-a',
      subTasks: [doneSub, undoneSub],
      subTaskIds: ['sub-done', 'sub-undone'],
    });

    const result = tasksToTreeNodes([task], null);

    expect(result[0].children!.length).toBe(2);
    expect(result[0].expanded).toBe(true);
  });

  it('should give task with no subtasks an empty children array', () => {
    const task = createMockTask({ id: 'task-a', subTasks: [] });
    const result = tasksToTreeNodes([task], null);

    expect(result[0].children).toEqual([]);
  });

  it('should set data property to the original task', () => {
    const task = createMockTask({ id: 'task-a', title: 'My Task' });
    const result = tasksToTreeNodes([task], null);

    expect(result[0].data).toBe(task);
  });

  it('should convert multiple tasks correctly', () => {
    const taskAlpha = createMockTask({ id: 'alpha', title: 'Alpha' });
    const taskBeta = createMockTask({ id: 'beta', title: 'Beta' });
    const result = tasksToTreeNodes([taskAlpha, taskBeta], null);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe('alpha');
    expect(result[1].id).toBe('beta');
  });
});

describe('getAfterTaskIdFromInstruction', () => {
  const siblingIds = ['sib-1', 'sib-2', 'sib-3', 'sib-4'];

  it('should return null for where === "inside"', () => {
    const instruction = createMoveInstruction({
      where: 'inside',
      targetId: 'sib-2',
    });
    const result = getAfterTaskIdFromInstruction(instruction, siblingIds);
    expect(result).toBeNull();
  });

  it('should return targetId for where === "after"', () => {
    const instruction = createMoveInstruction({
      where: 'after',
      targetId: 'sib-2',
    });
    const result = getAfterTaskIdFromInstruction(instruction, siblingIds);
    expect(result).toBe('sib-2');
  });

  it('should return null for where === "before" when target is first item', () => {
    const instruction = createMoveInstruction({
      where: 'before',
      targetId: 'sib-1',
    });
    const result = getAfterTaskIdFromInstruction(instruction, siblingIds);
    expect(result).toBeNull();
  });

  it('should return preceding sibling for where === "before" in middle', () => {
    const instruction = createMoveInstruction({
      where: 'before',
      targetId: 'sib-3',
    });
    const result = getAfterTaskIdFromInstruction(instruction, siblingIds);
    expect(result).toBe('sib-2');
  });

  it('should return null for where === "before" when target is not found', () => {
    const instruction = createMoveInstruction({
      where: 'before',
      targetId: 'nonexistent',
    });
    const result = getAfterTaskIdFromInstruction(instruction, siblingIds);
    expect(result).toBeNull();
  });

  it('should return null for where === "after" with empty targetId', () => {
    const instruction = createMoveInstruction({
      where: 'after',
      targetId: '',
    });
    const result = getAfterTaskIdFromInstruction(instruction, siblingIds);
    expect(result).toBeNull();
  });
});
