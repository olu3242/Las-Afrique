import { assignTask, completeAssignment, setTaskState } from "@/lib/groups/actions";
import { can } from "@/lib/groups/roles";
import type { GroupMemberView } from "@/lib/groups/service";
import type {
  GroupRole,
  GroupTaskAssignmentRow,
  GroupTaskRow,
} from "@/lib/supabase/types";
import { TaskForm } from "./task-form";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Shared work, and who is doing it.
 *
 * A member sees everything and may close their own assignment. Creating,
 * editing and assigning belong to coordinators — and the controls are absent
 * rather than disabled, because a disabled button for something you are not
 * allowed to do is a worse answer than no button.
 */
export function TaskBoard({
  groupId,
  tasks,
  assignments,
  members,
  role,
}: {
  groupId: string;
  tasks: GroupTaskRow[];
  assignments: GroupTaskAssignmentRow[];
  members: GroupMemberView[];
  role: GroupRole | null;
}) {
  const nameOf = (userId: string) =>
    members.find((m) => m.membership.user_id === userId)?.membership
      .display_name ?? "A traveller";

  return (
    <div className="flex flex-col gap-6">
      {tasks.length === 0 ? (
        <p className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4 text-sm text-muted">
          No tasks yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Group tasks">
          {tasks.map((task) => {
            const mine = assignments.filter((a) => a.task_id === task.id);
            return (
              <li
                key={task.id}
                className="rounded-xl border border-ivory/15 bg-indigo-900/40 px-5 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-base text-ivory">{task.title}</p>
                    <p className="mt-1 text-data text-sm text-muted">
                      {task.state}
                      {task.due_on ? ` · due ${formatDate(task.due_on)}` : ""}
                    </p>
                    {task.detail ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        {task.detail}
                      </p>
                    ) : null}
                  </div>

                  {can(role, "edit_task") && task.state !== "done" ? (
                    <form action={setTaskState} className="shrink-0">
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="state" value="done" />
                      <button
                        type="submit"
                        className="rounded-full border border-ivory/25 px-4 py-2 text-sm text-ivory transition-colors hover:border-ivory/50"
                      >
                        Mark done
                        <span className="sr-only"> {task.title}</span>
                      </button>
                    </form>
                  ) : null}
                </div>

                {mine.length > 0 ? (
                  <ul className="mt-4 flex flex-col gap-2">
                    {mine.map((assignment) => (
                      <li
                        key={assignment.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ivory/10 bg-indigo-800/40 px-4 py-2.5"
                      >
                        <span className="text-sm text-ivory">
                          {nameOf(assignment.assignee_id)}
                          {assignment.completed_at ? (
                            <span className="ml-2 text-label">done</span>
                          ) : null}
                        </span>
                        {!assignment.completed_at ? (
                          <form action={completeAssignment}>
                            <input type="hidden" name="groupId" value={groupId} />
                            <input
                              type="hidden"
                              name="assignmentId"
                              value={assignment.id}
                            />
                            <button
                              type="submit"
                              className="rounded-full border border-ivory/25 px-3 py-1.5 text-sm text-ivory transition-colors hover:border-ivory/50"
                            >
                              I&rsquo;ve done this
                              <span className="sr-only"> — {task.title}</span>
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {can(role, "assign_task") ? (
                  <form action={assignTask} className="mt-4 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`assign-${task.id}`}
                        className="text-xs font-medium text-muted"
                      >
                        Assign to
                      </label>
                      <select
                        id={`assign-${task.id}`}
                        name="assigneeId"
                        className="rounded-lg border border-ivory/20 bg-indigo-950 px-3 py-2 text-sm text-ivory"
                      >
                        {members.map((m) => (
                          <option key={m.membership.id} value={m.membership.user_id}>
                            {m.membership.display_name ?? "A traveller"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="rounded-full border border-ivory/25 px-4 py-2 text-sm text-ivory transition-colors hover:border-ivory/50"
                    >
                      Assign
                      <span className="sr-only"> {task.title}</span>
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {can(role, "create_task") ? <TaskForm groupId={groupId} /> : null}
    </div>
  );
}
