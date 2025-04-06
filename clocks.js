// This is a DataviewJS script for Obsidian to parse clock items from a page
// and generate a report of the clock items grouped by project and task.
//
// when working on this script, you have to navigate away from and then back to the page
// copyright 2024 Charl P. Botha <cpbotha@vxlabs.com>

// to experiment with code live, do the following in devtools:
// dv = app.plugins.plugins.dataview.api;
// page = dv.page("your page name here")

// dispatcher
if (input.cmd === "clock-report") {
    dv.header(2, "Clock Report");
    ptClocks = parsePageClocks(dv.current());
    // for debugging in devtools, insert variable in global scope
    window.ptClocks = ptClocks;

    // project: total duration
    // task: sum of duration for all clocks
    durations = {};
    total = 0;
    for (const project in ptClocks) {
        durations[project] = { minutes: 0, tasks: {} };
        for (const task in ptClocks[project]) {
            durations[project].tasks[task] = 0;
            for (const clock of ptClocks[project][task]) {
                // add to the task minutes
                durations[project].tasks[task] += clock.duration;
                // add to the total project minutes
                durations[project].minutes += clock.duration;
                total += clock.duration;
            }
        }
    }

    dv.paragraph(durations);
    // dv.table(
    //     ["Project", "Task", "Duration"],
    //     [
    //         ["project", "", 24],
    //         ["", "task", 12],
    //     ],
    // );
}

function parsePageClocks(page) {
    // https://blacksmithgu.github.io/obsidian-dataview/api/code-reference/
    curProject = null;
    curTask = null;
    ptClocks = {};
    for (const listItem of page.file.lists) {
        if (listItem.header.type === "header" && listItem.header.subpath !== curProject) {
            curProject = listItem.header.subpath;
            if (!(curProject in ptClocks)) {
                ptClocks[curProject] = {};
            }
            //console.log("PROJECT:", curProject)
        }

        // if item has a parent item and it as valid start and end timestamps, then it is a clock item
        const isClockItem = listItem.parent && listItem.start?.isLuxonDateTime && listItem.end?.isLuxonDateTime;
        // top-level items are task items
        const isTaskItem = !listItem.parent;
        // the first inline metadata [bleh:: or (bleh:: is the end of the item description
        const title = listItem.text.replace(/(\[.*?::.*?\]|\(.*?\)).*/g, "").trim();

        //console.log("ITEM:", listItem, isClockItem, isTaskItem, title);
        if (isTaskItem) {
            console.log("TASK ITEM:", title);
            if (title !== curTask) {
                curTask = title;
                if (curProject && !(curTask in ptClocks[curProject])) {
                    // console.log("TASK:", title);
                    ptClocks[curProject][curTask] = [];
                }
            }
        } else if (isClockItem) {
            console.log("CLOCK ITEM:", title);
            // now title is the description of this clock item
            // stricter check here that both start and end could be parsed
            if (curProject && curTask) {
                // minutes
                duration = (listItem.end - listItem.start) / 1000 / 60;
                ptClocks[curProject][curTask].push({
                    description: title,
                    duration,
                    start: listItem.start,
                    end: listItem.end,
                });
            }
        }
    }
    // if project - task is [], remove that task
    for (const project in ptClocks) {
        for (const task in ptClocks[project]) {
            if (ptClocks[project][task].length === 0) {
                // this means the task has no clocks, so we delete the task
                delete ptClocks[project][task];
            }
        }
    }

    // if project empty, remove that project
    for (const project in ptClocks) {
        if (Object.keys(ptClocks[project]).length === 0) {
            delete ptClocks[project];
        }
    }

    // map from heading to object which maps from task to array of clock items
    // each clock item has start, end, duration (minutes), description
    return ptClocks;
}
