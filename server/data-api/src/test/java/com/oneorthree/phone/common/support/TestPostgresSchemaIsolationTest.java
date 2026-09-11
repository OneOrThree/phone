package com.oneorthree.phone.common.support;

import com.oneorthree.phone.group.repository.domain.Group;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/** 공유 PostgreSQL에서 실제 JPA 컨텍스트의 부팅·종료가 이웃의 groups 테이블을 지우지 않는다. */
class TestPostgresSchemaIsolationTest {

    @Test
    @DisplayName("같은 PG의 다른 JPA 컨텍스트를 생성·종료·재생성해도 기존 그룹을 읽고 쓸 수 있다")
    void anotherContextLifecyclePreservesExistingGroups() {
        try (var first = openContext()) {
            UUID original = persistGroup(first, "원래 그룹");
            try (var second = openContext()) {
                assertGroup(first, original, "원래 그룹");
                UUID isolated = persistGroup(second, "다른 컨텍스트 그룹");
                try (var entityManager = first.getBean(EntityManagerFactory.class).createEntityManager()) {
                    assertThat(entityManager.find(Group.class, isolated)).isNull();
                }
            }
            assertGroup(first, original, "원래 그룹");
            UUID afterClose = persistGroup(first, "다른 컨텍스트 종료 후");
            try (var restarted = openContext()) {
                UUID recreated = persistGroup(restarted, "다시 부팅한 컨텍스트");
                assertGroup(restarted, recreated, "다시 부팅한 컨텍스트");
                assertGroup(first, afterClose, "다른 컨텍스트 종료 후");
            }
            assertGroup(first, original, "원래 그룹");
            assertGroup(first, persistGroup(first, "재부팅 종료 후"), "재부팅 종료 후");
        }
    }

    private AnnotationConfigApplicationContext openContext() {
        Map<String, Supplier<Object>> properties = new HashMap<>();
        TestPostgres.registerIsolatedSchema(properties::put);
        String jdbcUrl = (String) properties.get("spring.datasource.url").get();
        // 실제 커넥션과 Hibernate가 여러 번 프로퍼티를 읽어도 같은 스키마를 사용해야 한다.
        assertThat(properties.get("spring.datasource.url").get()).isEqualTo(jdbcUrl);
        var dataSource = new DriverManagerDataSource(jdbcUrl,
                (String) properties.get("spring.datasource.username").get(),
                (String) properties.get("spring.datasource.password").get());
        var context = new AnnotationConfigApplicationContext();
        context.registerBean("entityManagerFactory", LocalContainerEntityManagerFactoryBean.class, () -> {
            var factory = new LocalContainerEntityManagerFactoryBean();
            factory.setDataSource(dataSource);
            factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            // 실제 운영 Group 엔티티로 Hibernate DDL과 INSERT/SELECT를 실행한다.
            factory.setManagedTypes(PersistenceManagedTypes.of(Group.class.getName()));
            factory.setJpaPropertyMap(Map.of(
                    "hibernate.hbm2ddl.auto", "create-drop",
                    "hibernate.default_schema",
                    properties.get("spring.jpa.properties.hibernate.default_schema").get()));
            return factory;
        });
        try {
            context.refresh();
            return context;
        } catch (RuntimeException | Error e) {
            context.close();
            throw e;
        }
    }

    private UUID persistGroup(AnnotationConfigApplicationContext context, String name) {
        try (var entityManager = context.getBean(EntityManagerFactory.class).createEntityManager()) {
            var transaction = entityManager.getTransaction();
            transaction.begin();
            try {
                Group group = Group.builder().name(name).build();
                entityManager.persist(group);
                transaction.commit();
                return group.getId();
            } catch (RuntimeException | Error e) {
                if (transaction.isActive()) {
                    transaction.rollback();
                }
                throw e;
            }
        }
    }

    private void assertGroup(AnnotationConfigApplicationContext context, UUID id, String name) {
        try (var entityManager = context.getBean(EntityManagerFactory.class).createEntityManager()) {
            Group group = entityManager.find(Group.class, id);
            assertThat(group).isNotNull();
            assertThat(group.getName()).isEqualTo(name);
            // 기존 서비스의 무접두어 native SQL도 같은 스키마를 읽는지 확인한다.
            assertThat(entityManager.createNativeQuery("SELECT name FROM groups WHERE id = :id", String.class)
                    .setParameter("id", id).getSingleResult()).isEqualTo(name);
        }
    }
}
