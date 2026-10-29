package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** 건물 종류와 선행 관계를 같은 DB 조회에서 읽는다. */
@Repository
public class ConstructionBuildingRepository {

    private final JdbcTemplate jdbc;

    public ConstructionBuildingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<ConstructionBuilding> findAllOrdered() {
        return load("");
    }

    public Optional<ConstructionBuilding> findById(String id) {
        if (id == null) {
            return Optional.empty();
        }
        return load("WHERE b.id = ?", id).stream().findFirst();
    }

    private List<ConstructionBuilding> load(String filter, Object... args) {
        String sql = "SELECT b.id, b.display_name, b.funding, p.prerequisite_id "
                + "FROM construction_buildings b "
                + "LEFT JOIN construction_building_prerequisites p ON p.building_id = b.id "
                + filter + " ORDER BY b.display_order, b.id, p.prerequisite_id";
        return jdbc.query(sql, rs -> {
            Map<String, BuildingRow> rows = new LinkedHashMap<>();
            while (rs.next()) {
                String id = rs.getString("id");
                BuildingRow row = rows.get(id);
                if (row == null) {
                    row = new BuildingRow(rs.getString("display_name"),
                            ConstructionBuilding.Funding.valueOf(rs.getString("funding")));
                    rows.put(id, row);
                }
                String prerequisite = rs.getString("prerequisite_id");
                if (prerequisite != null) {
                    row.prerequisites.add(prerequisite);
                }
            }
            List<ConstructionBuilding> buildings = new ArrayList<>(rows.size());
            rows.forEach((id, row) -> buildings.add(new ConstructionBuilding(
                    id, row.displayName, row.funding, Set.copyOf(row.prerequisites))));
            return buildings;
        }, args);
    }

    private static final class BuildingRow {
        private final String displayName;
        private final ConstructionBuilding.Funding funding;
        private final Set<String> prerequisites = new LinkedHashSet<>();

        private BuildingRow(String displayName, ConstructionBuilding.Funding funding) {
            this.displayName = displayName;
            this.funding = funding;
        }
    }
}
