cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)

project(bare_notifications_darwin C OBJC)

add_bare_module(bare_notifications_darwin)

target_sources(
  ${bare_notifications_darwin}
  PRIVATE
    binding.m
)

target_link_libraries(
  ${bare_notifications_darwin}
  PRIVATE
    "-framework Foundation"
    "-framework UserNotifications"
)

target_compile_options(
  ${bare_notifications_darwin}
  PRIVATE
    -fobjc-arc
)
