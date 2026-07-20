import logging
import json
import os
from pathlib import Path
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from .models import Scenario

logger = logging.getLogger(__name__)

def load_scenarios_from_files():
    """
    Loads scenario data from JSON files in data/scenarios/ directory.
    Supports the field guide JSON format with nested structure.
    """
    # Get the project root directory (3 levels up from api/app/seed.py)
    project_root = Path(__file__).parent.parent.parent
    scenarios_dir = project_root / "data" / "scenarios"
    
    if not scenarios_dir.exists():
        logger.warning(f"Scenarios directory not found: {scenarios_dir}")
        return []
    
    all_scenarios = []
    domain_files = ['bnk_v1.json', 'bnk_v2.json', 'edu_v1.json', 'edu_v2.json', 
                    'trv_v1.json', 'trv_v2.json', 'vas_v1.json', 'vas_v2.json']
    
    for filename in domain_files:
        file_path = scenarios_dir / filename
        if not file_path.exists():
            logger.warning(f"Scenario file not found: {filename}")
            continue
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Handle the nested JSON structure from field guides
            if 'scenarios' in data and isinstance(data['scenarios'], list):
                # Nested format: { "scenarios": [...] }
                scenarios_list = data['scenarios']
            elif isinstance(data, list):
                # Flat list format: [...]
                scenarios_list = data
            else:
                logger.error(f"Unknown JSON format in {filename}")
                continue
            
            for scenario in scenarios_list:
                # Map field guide format to database format
                scenario_data = {
                    "scenario_id": scenario.get("scenario_id"),
                    "domain": scenario.get("domain"),
                    "intent": scenario.get("intent"),
                    "scenario_set": scenario.get("scenario_set"),
                    # Try both 'text_scenario' and 'text_hi' field names
                    "text_hi": scenario.get("text_hi") or scenario.get("text_scenario", ""),
                    "examples": scenario.get("examples", []),
                    "register": scenario.get("register", "neutral")
                }
                
                # Validation
                if not scenario_data["scenario_id"] or not scenario_data["intent"]:
                    logger.warning(f"Skipping invalid scenario in {filename}: {scenario}")
                    continue
                
                if not scenario_data["examples"] or len(scenario_data["examples"]) != 3:
                    logger.warning(f"Scenario {scenario_data['scenario_id']} doesn't have exactly 3 examples")
                
                all_scenarios.append(scenario_data)
            
            logger.info(f"Loaded {len(scenarios_list)} scenarios from {filename}")
            
        except Exception as e:
            logger.error(f"Error loading {filename}: {e}")
            continue
    
    logger.info(f"Total scenarios loaded from files: {len(all_scenarios)}")
    return all_scenarios


async def seed_scenarios(db: AsyncSession):
    """Seeds the scenario database if it is empty."""
    # Check if scenarios table already has records
    stmt = select(func.count(Scenario.scenario_id))
    res = await db.execute(stmt)
    count = res.scalar()
    
    if count > 0:
        logger.info(f"Scenario database already seeded with {count} records. Skipping.")
        return

    # Load scenarios from JSON files
    logger.info("Loading scenarios from JSON files...")
    scenarios_data = load_scenarios_from_files()
    
    if not scenarios_data:
        logger.error("No scenarios loaded! Check that JSON files exist in data/scenarios/")
        return

    logger.info(f"Seeding database with {len(scenarios_data)} scenarios...")
    for data in scenarios_data:
        scenario = Scenario(
            scenario_id=data["scenario_id"],
            domain=data["domain"],
            intent=data["intent"],
            scenario_set=data["scenario_set"],
            text_hi=data["text_hi"],
            examples=data["examples"],
            register=data["register"],
            use_count=0
        )
        db.add(scenario)
        
    await db.commit()
    logger.info(f"Successfully seeded database with {len(scenarios_data)} scenarios.")
