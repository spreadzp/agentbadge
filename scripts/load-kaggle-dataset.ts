#!/usr/bin/env bun

/**
 * Load and process Pima Indians Diabetes Dataset from Kaggle
 * 
 * Usage:
 *   bun scripts/load-kaggle-dataset.ts
 * 
 * This script:
 * 1. Downloads dataset from Kaggle (if not cached)
 * 2. Parses CSV data
 * 3. Generates medical records from real data
 * 4. Caches in memory for API endpoints
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

interface PimaRecord {
  Pregnancies: number;
  Glucose: number;
  BloodPressure: number;
  SkinThickness: number;
  Insulin: number;
  BMI: number;
  DiabetesPedigreeFunction: number;
  Age: number;
  Outcome: number;
}

interface MedicalData {
  patientId: string;
  patientName: string;
  age: number;
  gender: string;
  vitalSigns: {
    bloodPressure: number;
    heartRate: number;
    temperature: number;
    respiratoryRate: number;
  };
  labResults: {
    glucose: number;
    bmi: number;
    insulin: number;
    skinThickness: number;
    hemoglobin: number;
    cholesterol: number;
  };
  medicalHistory: {
    pregnancies: number;
    diabetesPedigree: number;
  };
}

// Global cache for dataset
let cachedDataset: PimaRecord[] = [];

/**
 * Download Kaggle dataset using CLI
 */
async function downloadKaggleDataset(): Promise<string> {
  const dataDir = path.join(process.cwd(), 'data');
  const csvPath = path.join(dataDir, 'diabetes.csv');

  // Create data directory if it doesn't exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Check if file already exists
  if (fs.existsSync(csvPath)) {
    console.log('✓ Dataset already cached at:', csvPath);
    return csvPath;
  }

  console.log('📥 Downloading Pima Indians Diabetes Dataset from Kaggle...');

  return new Promise((resolve, reject) => {
    const kaggle = spawn('kaggle', [
      'datasets', 'download',
      '-d', 'uciml/pima-indians-diabetes-database',
      '-p', dataDir,
      '--unzip'
    ]);

    kaggle.on('close', (code) => {
      if (code === 0) {
        console.log('✓ Dataset downloaded successfully');
        resolve(csvPath);
      } else {
        reject(new Error(`Kaggle download failed with code ${code}`));
      }
    });

    kaggle.on('error', (err) => {
      reject(new Error(`Failed to spawn kaggle: ${err.message}`));
    });
  });
}

/**
 * Parse CSV file and return records
 */
function parseCSV(csvPath: string): PimaRecord[] {
  console.log('📖 Parsing CSV file...');

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');

  const records: PimaRecord[] = lines.slice(1).map((line) => {
    const values = line.split(',');
    return {
      Pregnancies: parseInt(values[0]),
      Glucose: parseInt(values[1]),
      BloodPressure: parseInt(values[2]),
      SkinThickness: parseInt(values[3]),
      Insulin: parseInt(values[4]),
      BMI: parseFloat(values[5]),
      DiabetesPedigreeFunction: parseFloat(values[6]),
      Age: parseInt(values[7]),
      Outcome: parseInt(values[8])
    };
  });

  console.log(`✓ Parsed ${records.length} medical records`);
  return records;
}

/**
 * Convert Pima record to MedicalData format
 */
function convertToMedicalData(record: PimaRecord, index: number): MedicalData {
  // Generate realistic vital signs based on age and BMI
  const heartRate = 60 + Math.random() * 40;
  const temperature = 36.5 + Math.random() * 1.5;
  const respiratoryRate = 12 + Math.random() * 8;

  // Generate realistic lab values
  const hemoglobin = 12 + Math.random() * 4; // 12-16 g/dL
  const cholesterol = 150 + Math.random() * 100; // 150-250 mg/dL

  return {
    patientId: `P${String(index).padStart(5, '0')}`,
    patientName: `Patient ${record.Age}y`,
    age: record.Age,
    gender: Math.random() > 0.5 ? 'M' : 'F', // Pima dataset is all female, but vary for demo
    vitalSigns: {
      bloodPressure: record.BloodPressure || 120,
      heartRate: Math.round(heartRate),
      temperature: Math.round(temperature * 10) / 10,
      respiratoryRate: Math.round(respiratoryRate)
    },
    labResults: {
      glucose: record.Glucose,
      bmi: Math.round(record.BMI * 10) / 10,
      insulin: record.Insulin,
      skinThickness: record.SkinThickness,
      hemoglobin: Math.round(hemoglobin * 10) / 10,
      cholesterol: Math.round(cholesterol)
    },
    medicalHistory: {
      pregnancies: record.Pregnancies,
      diabetesPedigree: Math.round(record.DiabetesPedigreeFunction * 100) / 100
    }
  };
}

/**
 * Get random medical record from dataset
 */
function getRandomMedicalData(): MedicalData {
  if (cachedDataset.length === 0) {
    throw new Error('Dataset not loaded. Call loadDataset() first.');
  }

  const randomIndex = Math.floor(Math.random() * cachedDataset.length);
  const record = cachedDataset[randomIndex];
  return convertToMedicalData(record, randomIndex);
}

/**
 * Get all medical records from dataset
 */
function getAllMedicalData(): MedicalData[] {
  if (cachedDataset.length === 0) {
    throw new Error('Dataset not loaded. Call loadDataset() first.');
  }

  return cachedDataset.map((record, index) =>
    convertToMedicalData(record, index)
  );
}

/**
 * Load and cache dataset
 */
async function loadDataset(): Promise<void> {
  try {
    const csvPath = await downloadKaggleDataset();
    cachedDataset = parseCSV(csvPath);
    console.log(`✓ Dataset loaded and cached (${cachedDataset.length} records)`);
  } catch (error) {
    console.error('❌ Error loading dataset:', error);
    throw error;
  }
}

/**
 * Print dataset statistics
 */
function printStatistics(): void {
  if (cachedDataset.length === 0) {
    console.log('⚠️  Dataset not loaded');
    return;
  }

  console.log('\n📊 Dataset Statistics:');
  console.log(`Total records: ${cachedDataset.length}`);

  const diabetesCount = cachedDataset.filter((r) => r.Outcome === 1).length;
  const nonDiabetesCount = cachedDataset.length - diabetesCount;

  console.log(`Diabetes cases: ${diabetesCount} (${((diabetesCount / cachedDataset.length) * 100).toFixed(1)}%)`);
  console.log(`Non-diabetes cases: ${nonDiabetesCount} (${((nonDiabetesCount / cachedDataset.length) * 100).toFixed(1)}%)`);

  // Calculate averages
  const avgAge = (cachedDataset.reduce((sum, r) => sum + r.Age, 0) / cachedDataset.length).toFixed(1);
  const avgGlucose = (cachedDataset.reduce((sum, r) => sum + r.Glucose, 0) / cachedDataset.length).toFixed(1);
  const avgBMI = (cachedDataset.reduce((sum, r) => sum + r.BMI, 0) / cachedDataset.length).toFixed(1);
  const avgInsulin = (cachedDataset.reduce((sum, r) => sum + r.Insulin, 0) / cachedDataset.length).toFixed(1);

  console.log(`\nAverage age: ${avgAge} years`);
  console.log(`Average glucose: ${avgGlucose} mg/dL`);
  console.log(`Average BMI: ${avgBMI} kg/m²`);
  console.log(`Average insulin: ${avgInsulin} mu U/ml`);
}

/**
 * Demo: Generate and display sample medical records
 */
function demoGenerateSamples(count: number = 5): void {
  console.log(`\n🏥 Generating ${count} sample medical records:\n`);

  for (let i = 0; i < count; i++) {
    const data = getRandomMedicalData();
    console.log(`Sample ${i + 1}:`);
    console.log(`  Patient: ${data.patientName} (${data.patientId})`);
    console.log(`  Age: ${data.age} years, Gender: ${data.gender}`);
    console.log(`  Glucose: ${data.labResults.glucose} mg/dL`);
    console.log(`  BMI: ${data.labResults.bmi} kg/m²`);
    console.log(`  Blood Pressure: ${data.vitalSigns.bloodPressure} mmHg`);
    console.log(`  Heart Rate: ${data.vitalSigns.heartRate} bpm`);
    console.log('');
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('🏥 Pima Indians Diabetes Dataset Loader\n');

  try {
    // Load dataset
    await loadDataset();

    // Print statistics
    printStatistics();

    // Generate sample records
    demoGenerateSamples(5);

    console.log('✅ Dataset loaded successfully and ready for use!');
    console.log('\nTo use in your code:');
    console.log('  import { getRandomMedicalData, getAllMedicalData } from "./scripts/load-kaggle-dataset"');
    console.log('  const data = getRandomMedicalData();');
  } catch (error) {
    console.error('❌ Failed to load dataset:', error);
    process.exit(1);
  }
}

// Export functions for use in other modules
export { loadDataset, getRandomMedicalData, getAllMedicalData, PimaRecord, MedicalData };

// Run if executed directly
if (import.meta.main) {
  main();
}
