package com.csdemo.controller;

import com.csdemo.service.DemoService;
import com.csdemo.service.MatchPackageService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.LinkedHashMap;
import java.util.Map;

/** Desktop lifecycle adapter; all task state belongs to the services. */
@RestController
public class DesktopController {
  private final DemoService demos;
  private final MatchPackageService packages;
  public DesktopController(DemoService demos,MatchPackageService packages){this.demos=demos;this.packages=packages;}
  @GetMapping("/api/desktop/activity") public Map<String,Object> activity(){Map<String,Object> result=new LinkedHashMap<>(demos.desktopActivity());result.put("packages",packages.activeJobs());return result;}
}
