-- Moduły sesji, scen, historii kampanii i relacji zostały świadomie
-- wycofane z produktu. Zachowujemy istniejące dane pod nazwami legacy_*,
-- aby operacja była odwracalna i nie usuwała starych kampanii.
ALTER TABLE IF EXISTS campaign_shared_content_notes RENAME TO legacy_campaign_shared_content_notes;
ALTER TABLE IF EXISTS entity_relations RENAME TO legacy_entity_relations;
ALTER TABLE IF EXISTS campaign_timeline_events RENAME TO legacy_campaign_timeline_events;
ALTER TABLE IF EXISTS session_events RENAME TO legacy_session_events;
ALTER TABLE IF EXISTS session_scenes RENAME TO legacy_session_scenes;
ALTER TABLE IF EXISTS campaign_sessions RENAME TO legacy_campaign_sessions;
