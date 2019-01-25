const Airtable = require("airtable");
require("dotenv").config();
const moment = require("moment"); // TODO: Crate a custom function instead using a whole lib

// Configure Airtable connection
Airtable.configure({
  endpointUrl: "https://api.airtable.com",
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base("app1tVRxqZjcFdpMt");

/**
 * fetches items and their corresponding turn over tasks and formats them as objects
 * @param {string} unitId 
 */
async function fetchUnitItemsAndConstructInspectionItems(unitId) {
  const categories = [
    "Pre-Walkthrough",
    "Final Walkthrough",
    "Turnover",
    "Final Inspection"
  ];

  let items;
  try {
    items = await base("Items").select({
      view: "Grid view",
      filterByFormula: `OR({unit}=${unitId}, {type}="Fixture")`
    });
  } catch (error) {
    console.log('Error:::', error);
  }
  // let items = await base("Items").select({
  //   view: "Grid view",
  //   filterByFormula: `OR({unit}=${unitId}`
  // });

  let records;

  try {
    records = await items.all();
  } catch (error) {
    console.log('Error:::', error);
  }
  // const records = await items.all();

  const formattedItems = [];
  if (records) {
    for (let category of categories) {
      for (let item of records) {
        const turnoverTasks = item["fields"]["Turnover tasks"]; // Access Id's for Turnover tasks
        let tasks;
        if (turnoverTasks) {
          let filterByFormula = "OR(";
          for (const id of turnoverTasks) {
            filterByFormula = filterByFormula.concat(`RECORD_ID()='${id}'`);
            turnoverTasks.indexOf(id) !== turnoverTasks.length - 1
              ? (filterByFormula = filterByFormula.concat(","))
              : (filterByFormula = filterByFormula.concat(")"));
          }

          try {
            tasks = await base("Turnover Tasks").select({
              view: "Grid view",
              filterByFormula
            });
          } catch (error) {
            console.log('Error:::', error);
          }
          // tasks = await base("Turnover Tasks").select({
          //   view: "Grid view",
          //   filterByFormula
          // });
        }

        const formattedTasks = [];
        let itemTasks;
        try {
          itemTasks = await tasks.all();
        } catch (error) {
          console.log('Error:::', error);
        }
        // const itemTasks = await tasks.all();
        for (task of itemTasks) {
          const fields = task.fields;
          formattedTasks.push({
            id: task.id,
            taskName: fields.task_name,
            physicalId: fields.task_id
          });
        }
        formattedItems.push({
          unit: [item.fields.unit[0]],
          item: [item.id],
          category,
          date: moment(new Date()).format("MM/DD/YYYY"),
          turnoverTasks: formattedTasks
        });
      }
    }
    return formattedItems;
  }
}

fetchUnitItemsAndConstructInspectionItems(285873023222997).then(data=> {
  console.log('Data::', data);
  data.forEach(d=> {
    console.log('>>>>', d.turnoverTasks);
  })
}).catch(e=> {
  console.log('>>>>Error::', e)
})
 

/**
 * Copies items in the "Inpections Data" table for tracking and their corresponding "Turnover tasks" to the tasks Data
 * 
 * @param {string} unitId
 */
function createInspectionDataRecords(unitId) {
  let createItemsAndTasksPromises = [];
  fetchUnitItemsAndConstructInspectionItems(unitId).then(
    items => {
      for (let item of items) {
        const turnoverTasks = item.turnoverTasks;
        delete item.turnoverTasks;
        let createTask;
        const createItem = base("Inspections Data").create(
          item,
          (err, record) => {
            if (err) {
              console.error(err);
              return;
            }
            for (let task of turnoverTasks) {
              delete task.taskName;
              delete task.physicalId;
              task.task = [task.id];
              delete task.id;
              task.inspection_Id = [record.id];
              const createTask = base("Tasks Data").create(task, (err, rec) => {
                if (err) {
                  console.error("Task creation:", err);
                  return;
                }
              });
              createItemsAndTasksPromises.push(createTask);
            }
          }
        );

        createItemsAndTasksPromises.push(createItem);
      }
    },
    err => {
      console.log("Error:::", err);
    }
  );
  return Promise.all(createItemsAndTasksPromises);
}

// //createInspectionDataRecords(285873023222986);

/**
 * Get a unit items from inspection data table during an inspection with the turnover tasks
 *
 * @param {string} inspectionType One of the four inspeection types [ Pre-Walkthrough, FInal Walkthrough, Turnover , Final Insoection ]
 * @param {string} unitId
 * @param {string} moveoutId
 * @returns {Promise} 
 */
async function getUnitInspectionData(inspectionType, unitId, moveoutId) {
  const items = await base("Inspections Data").select({
    view: "Grid view",
    filterByFormula: `AND({unit}=${unitId}, {category}=${inspectionType}, {moveout_Id}=${moveoutId})`
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
      if (turnoverTasks) {
        for (let taskId of turnoverTasks) {
          tasksPromises.push(retrieveRecordById("Tasks Data", taskId));
        }
        tasksData = await Promise.all(tasksPromises);
        for (let taskData of tasksData) {
          const fields = taskData.fields;
          const referencedTask =
            fields["task"] &&
            (await retrieveRecordById("Turnover Tasks", fields["task"][0]));
          const linkedTaskInfo = referencedTask && {
            id: referencedTask.id,
            name: referencedTask.fields.task_name
          };
          const data = {
            id: taskData.id,
            taskId: fields.task_Id,
            done: fields["Done"],
            inspectionId: fields["inspection_Id"],
            linkedTaskInfo
          };
          formattedTasksData.push(data);
        }
      }

      const formattedItemRecord = {
        id: record.id,
        name: itemFields.name,
        unit: itemFields.unit,
        cost: itemFields["cost"],
        turnOverTeam: itemFields.turnover_team,
        turnoverTasks: formattedTasksData
      };
      const recordObject = {
        id: record.id,
        category: fields.category,
        moveoutId: fields.moveout_Id,
        condition: fields.condition,
        notes: fields.notes,
        item: formattedItemRecord,
        unit: fields.unit,
        done: fields.Done
      };
      formattedData.push(recordObject);
    }

    return formattedData;
  } catch (err) {
    console.log("Error::", err);
  }
}

/*
 * Get a unit items from inspection data table during pre-walkthrough with the turnover tasks
 * getUnitInspectionData("'Pre-Walkthrough'", 285873023222986, 285873023222967).then(async data => {
 *   console.log("Data::", data);
 * });
 */

/**
 * Retrieve  a single record using the ID and table name
 *
 * @param {string} tableName Name of table
 * @param {string} recordId Id of a record
 * @returns {Promise} Promise with the retrieved object
 */
async function retrieveRecordById(tableName, recordId) {
  const record = await base(`${tableName}`).find(`${recordId}`);
  return record;
}

/**
 * Check the status of a movout stage. 
 * TODO: Disable the stage button if it's done.
 * @param {string} moveoutId
 */ 
async function checkMoveoutInspectionStagesStatus(moveoutId) {
  const data = await base("Inspection Stages Data").select({
    view: "Grid view",
    filterByFormula: `{moveout_Id}=${moveoutId}`
  });

  const formattedData = [];

  const stagesData = await data.all();
  if (stagesData) {
    for (let stageData of stagesData) {
      const fields = stageData.fields;
      const stageId = fields.stage[0];
      const stageInfo = await retrieveRecordById("Inspection Stages", stageId);
      const data = {
        id: stageData.id,
        moveoutId: fields.moveout_Id,
        done: fields.Done,
        stage: { id: stageInfo.id, name: stageInfo.fields.stage }
      };
      formattedData.push(data);
    }
  }

  return formattedData;
}

/* 
 * checkMoveoutInspectionStagesStatus(285873023222986).then(data=> {
 *   console.log(data);
 * });
 */

/*
 * retrieveRecordById('Items', 'recYYqKaJ8sL1q81Q').then(record=> {
 *  const fields = record['fields'];
 *  const formattedRecord = { id: record.id, name: fields.name, unit: fields.unit, turnOverTeam: fields.turnover_team, turnoverTasks: fields['Turnover tasks'], inspections: fields["All Inspections"]}
 *  console.log(formattedRecord)
 * })
 */

/**
 * To update a linked record, provide the Id of the linked record in an array otherwise just provide a value for a normal field.
 *
 * @param {string} table // Name of the table
 * @param {string} recordId
 * @param {object} fieldsObject // key:value pair of record names and values. Note: For linked fields, the value is an array of Id(s)
 */
function updateRecord(table, recordId, fieldsObject) {
  return base(table).update(recordId, fieldsObject, (err, record) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(record["fields"]);
    return record;
  });
}

// updateRecord('Inspections Data', 'reczIK9kDvGtkTD8I', { Done: false }); // Normal field update
// updateRecord("Inspections Data", "reczIK9kDvGtkTD8I", {
//   unit: ["rec8lVinzVrSorPSG"] // Linked field update are provided as an array of Id`s
// });

/**
 * Fetch all records from any table
 *
 * @param {string} table Name of table
 * @returns {Promise} Resolves to fetched records
 */
async function fetchAllRecords(table) {
  const records = await base(table).select({
    view: "Grid view"
  });
  return await records.all();
}

/*
 * fetchAllRecords("Units").then(data=> {
 *   for(const d of data) {
 *     console.log({id: d.id, fields: d.fields})
 *   }
 * })
 */
