import Expo
import EXDevLauncher
import React
import ReactAppDependencyProvider
import UIKit

@main
public class AppDelegate: ExpoAppDelegate, EXDevLauncherControllerDelegate {
  private let reactNativeDelegate = ReactNativeDelegate()
  public var window: UIWindow?
  private var initialLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    print("[keepOn-native] didFinishLaunchingWithOptions")
    initialLaunchOptions = launchOptions

    // Ensure a key window exists before Expo subscribers (Dev Launcher) run.
    if window == nil {
      if #available(iOS 13.0, *) {
        if let scene = UIApplication.shared.connectedScenes
          .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
          let newWindow = UIWindow(windowScene: scene)
          newWindow.frame = scene.coordinateSpace.bounds
          window = newWindow
        } else {
          window = UIWindow(frame: UIScreen.main.bounds)
        }
      } else {
        window = UIWindow(frame: UIScreen.main.bounds)
      }
    }

    guard let window = window else {
      fatalError("[keepOn-native] Failed to create UIWindow")
    }

    if window.rootViewController == nil {
      let placeholder = UIViewController()
      placeholder.view.backgroundColor = .systemBackground
      window.rootViewController = placeholder
    }
    window.makeKeyAndVisible()

    // Bind React Native factory through ExpoAppDelegate
    reactNativeDelegate.dependencyProvider = RCTAppDependencyProvider()
    let factory = ExpoReactNativeFactory(delegate: reactNativeDelegate)
    self.bindReactNativeFactory(factory)
    ReactHost.shared.configure(factory: factory, launchOptions: launchOptions)

#if EXPO_CONFIGURATION_DEBUG
    // Prepare Dev Launcher and register delegate before Expo subscribers run.
    EXDevLauncherController.sharedInstance().autoSetupPrepare(self, launchOptions: launchOptions)
#endif

    let result = super.application(application, didFinishLaunchingWithOptions: launchOptions)

#if !EXPO_CONFIGURATION_DEBUG
    NavigationCoordinator.shared.start(in: window, launchOptions: launchOptions)
    print("[keepOn-native] NavigationCoordinator.start called (release)")
#endif

    return result
  }

  // MARK: - EXDevLauncherControllerDelegate
  public func devLauncherController(_ developmentClientController: EXDevLauncherController, didStartWithSuccess success: Bool) {
    print("[keepOn-native] DevLauncher didStart success=\(success)")
    guard success else { return }
    DispatchQueue.main.async {
      let win = self.window
        ?? UIApplication.shared.connectedScenes
          .compactMap { $0 as? UIWindowScene }
          .flatMap { $0.windows }
          .first { $0.isKeyWindow }

      guard let window = win else {
        print("[keepOn-native] DevLauncher callback but no key window; cannot start NavigationCoordinator")
        return
      }
      NavigationCoordinator.shared.start(in: window, launchOptions: self.initialLaunchOptions)
      print("[keepOn-native] NavigationCoordinator.start re-attached from DevLauncher delegate")
    }
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    // Allow Dev Launcher deep links when running manually.
    if EXDevLauncherController.sharedInstance().onDeepLink(url, options: options) {
      return true
    }

    if NavigationCoordinator.shared.handle(url: url) {
      return true
    }

    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    if let url = userActivity.webpageURL, NavigationCoordinator.shared.handle(url: url) {
      return true
    }

    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

// MARK: - React host + navigation owned by native

final class ReactHost {
  static let shared = ReactHost()
  private var factory: RCTReactNativeFactory?
  private var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  private init() {}

  func configure(factory: RCTReactNativeFactory, launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) {
    self.factory = factory
    self.launchOptions = launchOptions
  }

  func makeView(route: String, props: [AnyHashable: Any] = [:]) -> UIView {
    guard let factory else {
      fatalError("ReactHost: factory not configured")
    }
    let mergedProps = props.merging(["route": route], uniquingKeysWith: { _, new in new })
    return factory.rootViewFactory.view(
      withModuleName: "main",
      initialProperties: mergedProps,
      launchOptions: launchOptions
    )
  }
}

final class ReactScreenViewController: UIViewController {
  let route: String
  let initialProps: [AnyHashable: Any]

  init(route: String, props: [AnyHashable: Any] = [:], title: String? = nil) {
    self.route = route
    self.initialProps = props
    super.init(nibName: nil, bundle: nil)
    self.title = title
    print("[keepOn-native] ReactScreenViewController init route=\(route) props=\(props)")
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func loadView() {
    print("[keepOn-native] ReactScreenViewController loadView route=\(route)")
    view = ReactHost.shared.makeView(route: route, props: initialProps)
    view.backgroundColor = .systemBackground
  }
}

enum AppRoute: Equatable {
  case dashboard
  case calendar
  case finance
  case clientsHome
  case clientDetail(id: String)
  case addClient(status: String?)
  case settings
  case makeSale
  case auth
  case signup

  init?(url: URL) {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let segments = path.split(separator: "/").map(String.init)
    let first = segments.first?.lowercased()
    let second = segments.count > 1 ? segments[1].lowercased() : nil

    switch first {
    case nil, "dashboard":
      self = .dashboard
    case "calendar":
      self = .calendar
    case "finance":
      self = .finance
    case "settings":
      self = .settings
    case "clients":
      if second == "add" {
        let status = components.queryItems?.first(where: { $0.name == "status" })?.value
        self = .addClient(status: status)
      } else if let id = second, !id.isEmpty {
        self = .clientDetail(id: id)
      } else {
        self = .clientsHome
      }
    case "sales":
      if second == "make" {
        self = .makeSale
      } else {
        return nil
      }
    case "auth":
      self = .auth
    case "signup":
      self = .signup
    default:
      self = .dashboard
    }
  }
}

final class NavigationCoordinator {
  static let shared = NavigationCoordinator()

  private var window: UIWindow?

  // Tabs
  private let tabController = UITabBarController()
  private let dashboardNav = UINavigationController()
  private let calendarNav = UINavigationController()
  private let financeNav = UINavigationController()
  private let clientsNav = UINavigationController()
  private let settingsNav = UINavigationController()

  // Auth
  private let authNav = UINavigationController()

  private var isAuthenticated = false

  private init() {}

  func start(in window: UIWindow, launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) {
    self.window = window
    configureTabs()
    configureAuth()
    setAuthenticated(false, animated: false)
    debugDumpRoot("after devLauncher didStart")
  }

  func setAuthenticated(_ value: Bool, animated: Bool = true) {
    guard let window else { return }
    isAuthenticated = value
    let target = value ? tabController : authNav
    print("[keepOn-native] setAuthenticated=\(value), root -> \(type(of: target))")
    if window.rootViewController !== target {
      window.rootViewController = target
      window.makeKeyAndVisible()
      if animated {
        UIView.transition(with: window, duration: 0.24, options: .transitionCrossDissolve, animations: nil)
      }
    }
    debugDumpRoot("after setAuthenticated")
  }

  @discardableResult
  func handle(url: URL) -> Bool {
    guard let route = AppRoute(url: url) else { return false }
    DispatchQueue.main.async {
      self.navigate(to: route, replace: false)
    }
    return true
  }

  func route(path: String, replace: Bool = false) {
    guard let url = URL(string: path, relativeTo: URL(string: "https://app.local")) else { return }
    guard let route = AppRoute(url: url) else { return }
    DispatchQueue.main.async {
      self.navigate(to: route, replace: replace)
    }
  }

  func pop() {
    DispatchQueue.main.async {
      if let presented = self.tabController.presentedViewController {
        presented.dismiss(animated: true)
        return
      }

      if let nav = self.currentNav() {
        _ = nav.popViewController(animated: true)
      }
    }
  }

  private func configureTabs() {
    print("[keepOn-native] configureTabs")
    dashboardNav.viewControllers = [ReactScreenViewController(route: "dashboard", title: "Dashboard")]
    calendarNav.viewControllers = [ReactScreenViewController(route: "calendar", title: "Calendar")]
    financeNav.viewControllers = [ReactScreenViewController(route: "finance", title: "Finance")]
    clientsNav.viewControllers = [ReactScreenViewController(route: "clients", title: "Clients")]
    settingsNav.viewControllers = [ReactScreenViewController(route: "settings", title: "Settings")]

    dashboardNav.tabBarItem = UITabBarItem(title: "Dashboard", image: UIImage(systemName: "chart.bar"), selectedImage: nil)
    calendarNav.tabBarItem = UITabBarItem(title: "Calendar", image: UIImage(systemName: "calendar"), selectedImage: nil)
    financeNav.tabBarItem = UITabBarItem(title: "Finance", image: UIImage(systemName: "creditcard"), selectedImage: nil)
    clientsNav.tabBarItem = UITabBarItem(title: "Clients", image: UIImage(systemName: "person.2"), selectedImage: nil)
    settingsNav.tabBarItem = UITabBarItem(title: "Settings", image: UIImage(systemName: "gearshape"), selectedImage: nil)

    tabController.viewControllers = [dashboardNav, calendarNav, financeNav, clientsNav, settingsNav]
    tabController.tabBar.tintColor = .label
  }

  private func configureAuth() {
    print("[keepOn-native] configureAuth")
    let login = ReactScreenViewController(route: "authLogin", title: "Sign in")
    authNav.viewControllers = [login]
    authNav.navigationBar.prefersLargeTitles = true
  }

  private func navigate(to route: AppRoute, replace: Bool) {
    switch route {
    case .auth:
      setAuthenticated(false)
      authNav.popToRootViewController(animated: true)
    case .signup:
      setAuthenticated(false)
      let signup = ReactScreenViewController(route: "authSignup", title: "Create account")
      authNav.setViewControllers([signup], animated: true)
    case .dashboard:
      ensureAuthenticated()
      tabController.selectedViewController = dashboardNav
      dashboardNav.popToRootViewController(animated: false)
    case .calendar:
      ensureAuthenticated()
      tabController.selectedViewController = calendarNav
      calendarNav.popToRootViewController(animated: false)
    case .finance:
      ensureAuthenticated()
      tabController.selectedViewController = financeNav
      financeNav.popToRootViewController(animated: false)
    case .settings:
      ensureAuthenticated()
      tabController.selectedViewController = settingsNav
      settingsNav.popToRootViewController(animated: false)
    case .clientsHome:
      ensureAuthenticated()
      tabController.selectedViewController = clientsNav
      clientsNav.popToRootViewController(animated: false)
    case let .clientDetail(id):
      ensureAuthenticated()
      tabController.selectedViewController = clientsNav
      let detail = ReactScreenViewController(route: "clientDetail", props: ["clientId": id], title: "Client")
      if replace {
        clientsNav.setViewControllers([
          ReactScreenViewController(route: "clients", title: "Clients"),
          detail,
        ], animated: true)
      } else {
        clientsNav.popToRootViewController(animated: false)
        clientsNav.pushViewController(detail, animated: true)
      }
    case let .addClient(status):
      ensureAuthenticated()
      presentModally(
        route: "addClient",
        title: "Add client",
        props: status != nil ? ["status": status!] : [:],
        replace: replace
      )
    case .makeSale:
      ensureAuthenticated()
      presentModally(route: "makeSale", title: "Make sale", replace: replace)
    }
  }

  private func ensureAuthenticated() {
    if !isAuthenticated {
      setAuthenticated(true)
    }
  }

  private func presentModally(route: String, title: String?, props: [AnyHashable: Any] = [:], replace: Bool = false) {
    let vc = ReactScreenViewController(route: route, props: props, title: title)
    let nav = UINavigationController(rootViewController: vc)
    nav.modalPresentationStyle = .pageSheet
    nav.navigationBar.prefersLargeTitles = true
    print("[keepOn-native] presentModally route=\(route) replace=\(replace)")

    if replace, let presented = tabController.presentedViewController {
      presented.dismiss(animated: false) {
        self.currentNav()?.present(nav, animated: true)
      }
    } else {
      currentNav()?.present(nav, animated: true)
    }
  }

  private func currentNav() -> UINavigationController? {
    if let presented = tabController.presentedViewController as? UINavigationController {
      return presented
    }
    return tabController.selectedViewController as? UINavigationController
  }

  private func debugDumpRoot(_ label: String) {
    guard let window else { return }
    print("[keepOn-native] \(label) rootViewController = \(type(of: window.rootViewController))")
    if let tab = window.rootViewController as? UITabBarController {
      let children = tab.viewControllers?.map { String(describing: type(of: $0)) } ?? []
      print("[keepOn-native] \(label) tab children: \(children)")
    }
  }
}

@objc(NativeNavigation)
final class NativeNavigation: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func push(_ path: NSString) {
    NavigationCoordinator.shared.route(path: path as String, replace: false)
  }

  @objc func replace(_ path: NSString) {
    NavigationCoordinator.shared.route(path: path as String, replace: true)
  }

  @objc func back() {
    NavigationCoordinator.shared.pop()
  }

  @objc func setAuthenticated(_ authenticated: Bool) {
    NavigationCoordinator.shared.setAuthenticated(authenticated)
  }
}
