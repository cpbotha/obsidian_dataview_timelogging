// This is a DataviewJS script for Obsidian to parse clock items from a page
// and generate a report of the clock items grouped by project and task.
// copyright 2024 Charl P. Botha <cpbotha@vxlabs.com>
//
// To use, add this to a markdown file with timelogging entries
// ## Clock report
//
// ```dataviewjs
// await dv.view('dataview_timelogging/clocks', {cmd: "clock-report"})
// ```
//
// when working on this script, you have to navigate away from and then back to the page

// to experiment with code live, do the following in devtools:
// dv = app.plugins.plugins.dataview.api;
// page = dv.page("your page name here")

// dispatcher
if (input.cmd === "clock-report") {
    //dv.header(2, "Clock Report");
    ptClocks = parsePageClocks(dv.current());
    // for debugging in devtools, insert variable in global scope
    window.ptClocks = ptClocks;

    s = renderClockReport(ptClocks);
    dv.paragraph(s);

    // map from date to array of task descriptions according to the clock items for that day
    days = {};
    for (const project in ptClocks) {
        for (const task in ptClocks[project]) {
            for (const clock of ptClocks[project][task]) {
                // clock.start and clock.end are Luxon DateTime objects
                // get only the date part
                const startDate = clock.start.toFormat("yyyy-MM-dd ccc");
                if (!(startDate in days)) {
                    days[startDate] = [];
                }
                // store object with task name and clock item properties
                days[startDate].push({ project: project, task: task, ...clock });
            }
        }
    }

    for (const day in days) {
        // sort by start time
        days[day].sort((a, b) => a.start - b.start);
    }

    // sort the days by date
    const sortedDays = Object.keys(days).sort().reverse();
    for (const day of sortedDays) {
        dv.header(3, day);
        dv.table(
            ["Timeslot", "Duration", "Project / Task", "Description"],
            days[day].map((ptClock) => [
                `${ptClock.start.toFormat("HH:mm")} - ${ptClock.end.toFormat("HH:mm")}`,
                renderMins(ptClock.duration, false),
                `[[#${ptClock.project}]] / ${ptClock.task}`,
                ptClock.description,
            ]),
        );
        // sum up the durations for this day
        dayMinutes = 0;
        for (const ptClock of days[day]) {
            dayMinutes += ptClock.duration;
        }
        dv.paragraph(`Total time spent: ${renderMins(dayMinutes)}`);
    }

    // dv.table(
    //     ["Project", "Task", "Duration"],
    //     [
    //         ["project", "", 24],
    //         ["", "task", 12],
    //     ],
    // );
}

// 128h24m vs 128h 24m vs 128:24
function renderMins(minutes, showFraction = true) {
    // convert minutes to hours and minutes
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const hoursStr = hours > 0 ? `${hours}h·` : "";
    const fractionStr = showFraction ? ` (${(minutes / 60).toFixed(2)})` : "";
    return `${hoursStr}${mins}m${fractionStr}`;
}

function renderClockReport(ptClocks) {
    // project: total duration
    // task: sum of duration for all clocks
    durations = {};
    total = 0;
    earliest = null;
    latest = null;
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
                // we want to know what the total timespan of logged time is
                if (!earliest || clock.start < earliest) {
                    earliest = clock.start;
                }
                if (!latest || clock.end > latest) {
                    latest = clock.end;
                }
            }
        }
    }

    // output clock report as nested list
    const rangeDateFormatStr = "ccc yyyy-MM-dd HH:mm";
    s = `Total time clocked from ${earliest.toFormat(rangeDateFormatStr)} to ${latest.toFormat(rangeDateFormatStr)}: **${renderMins(total)}**\n`;
    for (const project in durations) {
        s += `- **${project}**: ${renderMins(durations[project].minutes)}\n`;
        for (const task in durations[project].tasks) {
            s += `  - *${task}:* ${renderMins(durations[project].tasks[task])}\n`;
        }
    }

    return s;
}

function extractOrgTimestampRange(line) {
    // matches e.g. <2025-01-01 Mon 12:00-14:00>
    // we want to convert to Luxon DateTime objects for start and end
    const regex = /(?:<|&lt;)(?:\[\[)?(\d{4}-\d{2}-\d{2})(?:\]\])? \w{3} (\d{2}:\d{2}(?:-\d{2}:\d{2})?)(?:>|&gt;)/g;
    const matches = regex.exec(line);
    if (matches) {
        // matches[1] is the date, matches[2] is the time
        const dateStr = matches[1];
        const timeStr = matches[2];
        // split timeStr on -
        const [startTime, endTime] = timeStr.split("-");
        if (!endTime) {
            return null; // no end time, so we cannot parse this
        }
        // create Luxon DateTime objects
        const start = dv.luxon.DateTime.fromFormat(`${dateStr} ${startTime}`, "yyyy-MM-dd HH:mm");
        let end;
        if (endTime) {
            end = dv.luxon.DateTime.fromFormat(`${dateStr} ${endTime}`, "yyyy-MM-dd HH:mm");
        } else {
            // if no end time, use start time as end time
            end = start;
        }
        // also return line with the whole matched string removed
        const textWithoutRange = line.replace(matches[0], "").trim();
        return { start, end, title: textWithoutRange };
    }
    return null; // no match
}

// this supports both org-style timestamp ranges and dataview start/end datetime fields
function parsePageClocks(page) {
    // https://blacksmithgu.github.io/obsidian-dataview/api/code-reference/
    curProject = null;
    curTask = null;
    ptClocks = {};
    for (const listItem of page.file.lists) {
        if (listItem.header.type === "header" && listItem.header.subpath !== curProject) {
            curProject = listItem.header.subpath;
            // we have just entered a new project, so we have to reset the current task
            // to prevent the bug where a same-named task at the start of a new project breaks parsing!
            curTask = null;
            if (!(curProject in ptClocks)) {
                ptClocks[curProject] = {};
            }
            //console.log("PROJECT:", curProject)
        }

        // first try to extract org-style
        let timeRange = extractOrgTimestampRange(listItem.text);
        // if that did not work, try to extract dataview-field-style Luxon DateTime objects
        if (!timeRange && listItem.start?.isLuxonDateTime && listItem.end?.isLuxonDateTime) {
            // the first inline metadata [bleh:: or (bleh:: is the end of the item description
            const title = listItem.text.replace(/(\[.*?::.*?\]|\(.*?::.*?\)).*/g, "").trim();
            timeRange = { start: listItem.start, end: listItem.end, title };
        }

        let title;
        if (timeRange) {
            // if we have a time range, then the title is the text without the time range
            title = timeRange.title;
        } else {
            // no time range, so the title is just the text
            title = listItem.text.trim();
        }

        // if item has a parent item and it as valid start and end timestamps, then it is a clock item
        const isClockItem = listItem.parent && timeRange;
        // top-level items are task items
        const isTaskItem = !listItem.parent;

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
            //console.log("CLOCK ITEM:", title);
            // now title is the description of this clock item
            // stricter check here that both start and end could be parsed
            if (curProject && curTask) {
                // minutes
                duration = (timeRange.end - timeRange.start) / 1000 / 60;
                ptClocks[curProject][curTask].push({
                    description: title,
                    duration,
                    start: timeRange.start,
                    end: timeRange.end,
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
