import express from "express";
import db from "../db/conn.mjs";
import { ObjectId } from "mongodb";

const router = express.Router();

/**
 * It is not best practice to seperate these routes
 * like we have done here. This file was created
 * specifically for educational purposes, to contain
 * all aggregation routes in one place.
 */

/**
 * Grading Weights by Score Type:
 * - Exams: 50%
 * - Quizes: 30%
 * - Homework: 20%
 */

// first bullet point objective
router.get("/stats", async (req, res) => {
  try {
    const collection = await db.collection("grades");
    let result = await collection
      .aggregate([
        // 1st stage: unwind scores array
        { $unwind: "$scores" },
        // 2nd stage: group student_id, class_id and type to calc the averages of exam, quiz, and homework categories
        {
          $group: {
            _id: {
              student_id: "$student_id",
              class_id: "$class_id",
              type: "$scores.type",
            },
            totalScore: { $sum: "$scores.score" }, // sum of scores in the same category
            count: { $sum: 1 }, // count of scores in the same category
          },
        },
        // 3rd: transform scores array to extract type and score fields
        {
          // project stage reshapes the documents -> allows for field inclusion, exclusion, or transformation
          $project: {
            // assign values of 2nd stage's id field
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            // new fields created (type and averaegScore) + assigns new fields to respective data
            type: "$_id.type",
            averageScore: { $divide: ["$totalScore", "$count"] },
          },
        },
        // 4th stage: add a field of weighted score
        {
          $addFields: {
            weightedScore: {
              // assigns weightedScore field to what's inside these curly brackets
              $switch: {
                // allows for different cases - much like switch-case statements
                branches: [
                  {
                    // if the type field from our document = "exam", then multiply by .5 (50% value) and pair that value
                    case: { $eq: ["$type", "exam"] },
                    then: { $multiply: ["$averageScore", 0.5] },
                  },
                  {
                    // if the type field from our document = "quiz", then multiply by .3 (30% value)
                    case: { $eq: ["$type", "quiz"] },
                    then: { $multiply: ["$averageScore", 0.3] },
                  },
                  {
                    // if the type field from our document = "homework", then multiply by .2 (20% value)
                    case: { $eq: ["$type", "homework"] },
                    then: { $multiply: ["$averageScore", 0.2] },
                  },
                ],
                // a default value in case no branch conditions are met
                default: 0,
              },
            },
          },
        },
        // 5th stage: groups student_id and class_id into one object to be pair into one field
        {
          $group: {
            _id: { student_id: "$student_id", class_id: "$class_id" },
            // calculates sum and pairs it as the new value for the averageScore field
            averageScore: { $sum: "$weightedScore" },
          },
        },
        // 6th stage: calc number of students with > 70 average and total students
        {
          $group: {
            _id: null,
            totalStudents: { $sum: 1 }, // Count of all students
            highScorers: {
              $sum: {
                $cond: [{ $gt: ["$averageScore", 70] }, 1, 0],
              }, // count of students with average > 70
            },
          },
        },
        // 7th stage: calc percentage
        {
          $project: {
            _id: 0,
            totalStudents: 1,
            highScorers: 1,
            percentageHighScorers: {
              $multiply: [{ $divide: ["$highScorers", "$totalStudents"] }, 100], // convert ratio to percentage
            },
          },
        },
      ])
      .toArray();

    res.send(result);
  } catch (error) {
    res.send("Error occurred.").status(500);
  }
});

router.get("/stats/:id", async (req, res) => {
  try {
    const collection = await db.collection("grades");
    let result = await collection
      .aggregate([
        // extra step for this route - first match with req.params.id before anything else
        { $match: { class_id: req.params.id } },
        { $unwind: "$scores" },
        {
          $group: {
            _id: {
              student_id: "$student_id",
              class_id: "$class_id",
              type: "$scores.type",
            },
            totalScore: { $sum: "$scores.score" },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            type: "$_id.type",
            averageScore: { $divide: ["$totalScore", "$count"] },
          },
        },
        {
          $addFields: {
            weightedScore: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ["$type", "exam"] },
                    then: { $multiply: ["$averageScore", 0.5] },
                  },
                  {
                    case: { $eq: ["$type", "quiz"] },
                    then: { $multiply: ["$averageScore", 0.3] },
                  },
                  {
                    case: { $eq: ["$type", "homework"] },
                    then: { $multiply: ["$averageScore", 0.2] },
                  },
                ],
                default: 0,
              },
            },
          },
        },
        {
          $group: {
            _id: { student_id: "$student_id", class_id: "$class_id" },
            averageScore: { $sum: "$weightedScore" },
          },
        },
        {
          $group: {
            _id: null,
            totalStudents: { $sum: 1 },
            highScorers: {
              $sum: {
                $cond: [{ $gt: ["$averageScore", 70] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            totalStudents: 1,
            highScorers: 1,
            percentageHighScorers: {
              $multiply: [{ $divide: ["$highScorers", "$totalStudents"] }, 100],
            },
          },
        },
      ])
      .toArray();

    res.send(result);
  } catch (error) {
    res.send("Error occurred.").status(500);
  }
});

// Get the weighted average of a specified learner's grades, per class
router.get("/learner/:id/avg-class", async (req, res) => {
  let collection = await db.collection("grades");

  let result = await collection
    .aggregate([
      {
        $match: { learner_id: Number(req.params.id) },
      },
      {
        $unwind: { path: "$scores" },
      },
      {
        $group: {
          _id: "$class_id",
          quiz: {
            $push: {
              $cond: {
                if: { $eq: ["$scores.type", "quiz"] },
                then: "$scores.score",
                else: "$$REMOVE",
              },
            },
          },
          exam: {
            $push: {
              $cond: {
                if: { $eq: ["$scores.type", "exam"] },
                then: "$scores.score",
                else: "$$REMOVE",
              },
            },
          },
          homework: {
            $push: {
              $cond: {
                if: { $eq: ["$scores.type", "homework"] },
                then: "$scores.score",
                else: "$$REMOVE",
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          class_id: "$_id",
          avg: {
            $sum: [
              { $multiply: [{ $avg: "$exam" }, 0.5] },
              { $multiply: [{ $avg: "$quiz" }, 0.3] },
              { $multiply: [{ $avg: "$homework" }, 0.2] },
            ],
          },
        },
      },
    ])
    .toArray();

  if (!result) res.send("Not found").status(404);
  else res.send(result).status(200);
});

export default router;
