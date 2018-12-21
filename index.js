const Airtable = require("airtable");
require('dotenv').config();

Airtable.configure({
  endpointUrl: "https://api.airtable.com",
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base("app1tVRxqZjcFdpMt");

/**
 * fetches items and formats them as objects
 */
async function fetchUnitItemsAndConstructInspectionItems() {
  const unitId = 285873023222986;
  const categories = [
    "Pre-Walkthrough",
    "Final Walkthrough",
    "Turnover",
    "Final Inspection"
  ];
  let items = await base("Items").select({
    view: "Grid view",
    filterByFormula: `{unit}=${unitId}`
  });

  const records = await items.all();

  const formattedItems = [];
  if (records) {
    for (let category of categories) {
      for (let item of records) {
        formattedItems.push({
          unit: [item.fields.unit[0]],
          item: [item.id],
          category
        });
      }
    }
    return formattedItems;
  }
}

function getUnitItemsAndurnoverTasks() {
  const unitId = 285873023222986;
  base("Items")
    .select({
      view: "Grid view",
      filterByFormula: `OR({unit}=${unitId})` // Use unit Id's here
    })
    .eachPage(
      async records => {
        for (const itemRecord of records) {
          const itemName = itemRecord["fields"]["name"];
          var turnoverTasks = itemRecord["fields"]["Turnover tasks"]; // Access Id's for Turnover tasks
          if (turnoverTasks) {
            // Construct a filter query for all the Turnover Tasks ID's
            let filterByFormula = "OR(";
            for (const id of turnoverTasks) {
              filterByFormula = filterByFormula.concat(`RECORD_ID()='${id}'`);
              turnoverTasks.indexOf(id) !== turnoverTasks.length - 1
                ? (filterByFormula = filterByFormula.concat(","))
                : (filterByFormula = filterByFormula.concat(")"));
            }
            await base("Turnover Tasks")
              .select({
                view: "Grid view",
                filterByFormula
              })
              .eachPage(
                records => {
                  console.log(
                    `*------------${itemName} Turnover Tasks-----------*`
                  );
                  for (let record of records) {
                    console.log(
                      "Turn over Tasks",
                      record["fields"]["task_name"]
                    );
                  }
                },
                err => {
                  if (err) {
                    console.error(err);
                    return;
                  }
                }
              );
          }
        }
      },
      err => {
        if (err) {
          console.error(err);
          return;
        }
      }
    );
}

/**
 * Copies items in the "Inpections Data" table for tracking
 */

function createInspectionDataRecords() {
  let createItemsPromises = [];
  fetchUnitItemsAndConstructInspectionItems().then(items => {
    for (let item of items) {
      const createItem = base("Inspections Data").create(item, function(
        err,
        record
      ) {
        if (err) {
          console.error(err);
          return;
        }
        console.log(record.getId());
      });
      createItemsPromises.push(createItem);
    }
  });
  return Promise.all(createItemsPromises);
}

// createInspectionDataRecords();

// Get a unit items from inspection data table during pre-walkthrough with the turnover tasks
async function getUnitInspectionData(inspectionType, unitId) {
  let items = await base("Inspections Data").select({
    view: "Grid view",
    filterByFormula: `AND({unit}=${unitId}, {category}=${inspectionType})`
  });

  try {
    const data = await items.all();
    const formattedData = [];
    for (let record of data) {
      const fields = record["fields"];
      const item = await retrieveRecordById("Items", fields.item[0]);
      const itemFields = item["fields"];
      const turnoverTasks = fields["Tasks Data"];
      const tasksPromises = [];
      let tasksData;
      let formattedTasksData = [];
      if(turnoverTasks) {
        for(let taskId of turnoverTasks) tasksPromises.push(retrieveRecordById("Tasks Data", taskId));
        tasksData = await Promise.all(tasksPromises);
        for(let taskData of tasksData) {
          const fields = taskData.fields;
          const referencedTask = fields['task'] && await retrieveRecordById("Turnover Tasks", fields['task'][0]);
          const linkedTaskInfo = referencedTask && { id: referencedTask.id, name: referencedTask.fields.task_name }
          const data = { id: taskData.id, taskId: fields.task_Id, done: fields['Done'], inspectionId: fields['inspection_Id'], linkedTaskInfo }
          formattedTasksData.push(data);
        }
      }
      
      const formattedRecord = {
        id: record.id,
        name: itemFields.name,
        unit: itemFields.unit,
        cost: itemFields['cost'],
        turnOverTeam: itemFields.turnover_team,
        turnoverTasks: formattedTasksData,
      };
      const recordObject = {
        id: record.id,
        category: fields.category,
        moveoutId: fields.moveout_Id,
        condition: fields.condition,
        notes: fields.notes,
        item: formattedRecord,
        unit: fields.unit,
        done: fields.done
      };
      formattedData.push(recordObject);
    }
  
    console.log("Data::", formattedData);
    return formattedData;
    // return records;
  } catch (err) {
    console.log("Error::", err);
  }
}

// Get a unit items from inspection data table during pre-walkthrough with the turnover tasks
getUnitInspectionData("'Pre-Walkthrough'", 285873023222986).then(async data => {
  console.log('Data::', data);
});

// Retrieve  a single record using the ID and table name
async function retrieveRecordById(tableName, recordId) {
  const record = await base(`${tableName}`).find(`${recordId}`);
  return record;
}

// retrieveRecordById('Items', 'recYYqKaJ8sL1q81Q').then(record=> {
//   const fields = record['fields'];
//   const formattedRecord = { id: record.id, name: fields.name, unit: fields.unit, turnOverTeam: fields.turnover_team, turnoverTasks: fields['Turnover tasks'], inspections: fields["All Inspections"]}
//   console.log(formattedRecord)
// })
